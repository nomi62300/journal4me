#!/usr/bin/env bash
#
# Seeds realistic demo trades (and fixes any $0 starting balances) for every
# active account belonging to one user, so the dashboard/accounts/trades
# screens have real data to render instead of empty states.
#
# Runs against the LOCAL stack only — connects straight to the Postgres
# container the same way scripts/rls-test.sh does. Never point this at a
# hosted project: it temporarily disables the trades quota trigger (see
# below) which must never happen against real user data.
#
# Usage:  ./scripts/seed-demo-data.sh [email] [trades_per_account]
#   email               defaults to m3test@journal4me.local
#   trades_per_account  defaults to 35

set -euo pipefail

EMAIL=${1:-m3test@journal4me.local}
COUNT=${2:-35}
DB=${SUPABASE_DB_CONTAINER:-supabase_db_journal4me}

echo "Seeding demo trades for $EMAIL ($COUNT trades/account)..."

# The statement-level quota trigger (20260902091542) enforces the real
# 30-trades/month free-tier cap on every insert regardless of role, which is
# correct for the product but wrong for backdated demo data logged in one
# shot. Disabled for this session only. The trap guarantees it is re-enabled
# even if the seeding statement below fails partway — a crashed run must
# never leave real quota enforcement off.
docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "alter table public.trades disable trigger trades_enforce_quota;"
trap 'docker exec -i "$DB" psql -U postgres -d postgres -c "alter table public.trades enable trigger trades_enforce_quota;" >/dev/null' EXIT

docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v email="$EMAIL" -v trade_count="$COUNT" <<'SQL'
-- psql does not substitute :variables inside dollar-quoted (do $$ ... $$)
-- bodies, so the parameters are stashed as session GUCs here first and read
-- back inside the block with current_setting() instead.
select set_config('app.seed_email', :'email', false);
select set_config('app.seed_count', :'trade_count', false);

do $$
declare
  v_user_id uuid;
  v_account record;
  v_symbols text[];
  v_symbol text;
  v_direction text;
  v_is_open boolean;
  v_win boolean;
  v_entry numeric;
  v_exit numeric;
  v_stop numeric;
  v_stop_distance numeric;
  v_size numeric;
  v_pnl numeric;
  v_entry_time timestamptz;
  v_exit_time timestamptz;
  v_scale numeric;
  i int;
  n int := current_setting('app.seed_count')::int;
  v_email text := current_setting('app.seed_email');
begin
  select id into v_user_id from auth.users where email = v_email;
  if v_user_id is null then
    raise exception 'No user found with email %', v_email;
  end if;

  for v_account in
    select id, account_type, currency, starting_balance
      from public.accounts
     where user_id = v_user_id and not is_archived
  loop
    -- Demo convenience only: a freshly-created account sitting at the $0
    -- wizard default isn't worth journaling against, so give it a plausible
    -- size. Never touches an account the user already funded on purpose.
    if v_account.starting_balance = 0 then
      update public.accounts
         set starting_balance = case v_account.account_type
               when 'prop_firm' then 100000
               else 10000
             end
       where id = v_account.id;
    end if;

    v_symbols := case v_account.account_type
      when 'prop_firm' then array['XAUUSD','US30','NAS100','EURUSD','GBPUSD']
      else array['EURUSD','GBPUSD','XAUUSD','BTCUSD']
    end;

    for i in 1..n loop
      v_symbol := v_symbols[1 + floor(random() * array_length(v_symbols, 1))::int];
      v_direction := case when random() < 0.5 then 'long' else 'short' end;
      -- ~12% left open, rest closed with a ~55% win rate (a believable
      -- positive-edge demo account, not a suspiciously perfect one).
      v_is_open := random() < 0.12;
      v_win := random() < 0.55;

      v_entry_time := now() - (random() * 63) * interval '1 day'
                            - (random() * 8) * interval '1 hour';

      v_scale := case v_symbol
        when 'EURUSD' then 1.08 when 'GBPUSD' then 1.27
        when 'XAUUSD' then 2450 when 'BTCUSD' then 64000
        when 'US30' then 39500 when 'NAS100' then 19200
        else 1
      end;
      v_entry := round((v_scale * (0.98 + random() * 0.04))::numeric, 4);

      -- Stop on the losing side of entry, a believable 0.15%-1.2% of price
      -- away. Fixed for open trades (nothing else to size against yet);
      -- closed trades keep this same realistic distance and instead derive
      -- `size` below so the dollar pnl and r_multiple both land right —
      -- deriving stop distance from pnl/size instead (the original approach)
      -- routinely pushed the stop through zero or produced 1000R nonsense,
      -- because this schema has no per-instrument contract/pip value to
      -- reconcile raw price movement with realistic dollar pnl.
      v_stop_distance := v_entry * (0.0015 + random() * 0.0105);
      v_stop := case v_direction
        when 'long' then round((v_entry - v_stop_distance)::numeric, 4)
        else round((v_entry + v_stop_distance)::numeric, 4)
      end;
      v_size := case
        when v_symbol = 'BTCUSD' then round((0.01 + random() * 0.2)::numeric, 3)
        else round((0.1 + random() * 1.9)::numeric, 2)
      end;

      if v_is_open then
        insert into public.trades (
          user_id, account_id, symbol, direction, entry_price, stop_loss_price,
          size, entry_time, commission, swap, source
        ) values (
          v_user_id, v_account.id, v_symbol, v_direction, v_entry, v_stop,
          v_size, v_entry_time, round((random() * 5)::numeric, 2), 0, 'manual'
        );
      else
        v_exit_time := v_entry_time + (random() * 6 + 0.25) * interval '1 hour';
        v_pnl := case v_account.account_type
          when 'prop_firm' then round(((case when v_win then random()*900+80 else -(random()*650+60) end))::numeric, 2)
          else round(((case when v_win then random()*260+20 else -(random()*180+15) end))::numeric, 2)
        end;

        -- Pick a believable target R (win: 0.6R-3.2R, loss: -0.3R to -1.1R,
        -- i.e. losses mostly cut near planned risk, wins run further) and
        -- back out the size that makes r_multiple = pnl/(stop_distance*size)
        -- land there, keeping the stop distance realistic and letting size
        -- (which this demo has no reason to hold to a "0.1-2 lots" fiction)
        -- absorb the scaling instead.
        declare
          v_target_r numeric := case
            when v_win then 0.6 + random() * 2.6
            else -(0.3 + random() * 0.8)
          end;
        begin
          v_size := round((abs(v_pnl / v_target_r) / v_stop_distance)::numeric, 2);
        end;

        -- Directionally consistent with the win/loss draw so the price story
        -- reads right, even though it isn't derived from pnl/size/contract
        -- spec (this schema doesn't model per-instrument contract value).
        v_exit := case
          when v_direction = 'long' and v_win  then round((v_entry * (1 + random() * 0.02))::numeric, 4)
          when v_direction = 'long' and not v_win then round((v_entry * (1 - random() * 0.012))::numeric, 4)
          when v_direction = 'short' and v_win then round((v_entry * (1 - random() * 0.02))::numeric, 4)
          else round((v_entry * (1 + random() * 0.012))::numeric, 4)
        end;

        insert into public.trades (
          user_id, account_id, symbol, direction, entry_price, exit_price,
          stop_loss_price, size, entry_time, exit_time, pnl, commission, swap,
          setup_grade, source
        ) values (
          v_user_id, v_account.id, v_symbol, v_direction, v_entry, v_exit,
          v_stop, v_size, v_entry_time, v_exit_time, v_pnl,
          round((random() * 6)::numeric, 2), round((random() * 2 - 1)::numeric, 2),
          (array['A+','A','A','B','B','C'])[1 + floor(random() * 6)::int],
          'manual'
        );
      end if;
    end loop;
  end loop;

  raise notice 'Seeded % trades per active account for %', n, v_email;
end $$;
SQL

echo "Done."
