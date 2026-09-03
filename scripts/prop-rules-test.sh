#!/usr/bin/env bash
#
# Prop firm rule engine — schema acceptance test (M6a).
#
# The build plan sets one bar for this schema, and it is deliberately harsh:
# FTMO (static drawdown), Topstep (trailing on closing balance) and Apex
# (trailing on the intraday equity high, locking $100 above starting balance)
# must each be expressible as profile DATA, with no schema change and no
# branching code. Likewise all four phase topologies — 3-phase, 2-phase,
# 1-phase and instant-funded. If any of them needs a code path, the model is
# wrong, and it is far cheaper to learn that here than after users have
# challenges running on it.
#
# It also covers the guards that make the model safe to hand to a UI: the
# freeze-on-first-use rule that keeps history judged under the rules that were
# actually in force, the composite foreign key that stops a rule being pinned
# to another profile's phase, and cross-tenant isolation on all nine new
# tables — because an RLS gap here leaks another trader's entire rulebook and
# breach history, and RLS failures are silent by nature.
#
# Runs against the LOCAL stack only. Usage:  ./scripts/prop-rules-test.sh
set -uo pipefail

API=${SUPABASE_API_URL:-http://127.0.0.1:54321}
KEY=${SUPABASE_SERVICE_KEY:-sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz}
DB=${SUPABASE_DB_CONTAINER:-supabase_db_journal4me}

pass=0; fail=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }

# `set role authenticated` is what makes any of this meaningful — a superuser
# bypasses RLS entirely, so without it every policy would appear to pass.
as_user() {
  local uid=$1; shift
  docker exec -i "$DB" psql -U postgres -d postgres -q -t -v ON_ERROR_STOP=1 <<SQL 2>&1
set request.jwt.claims = '{"sub":"$uid","role":"authenticated"}';
set role authenticated;
$*
SQL
}

as_owner() { docker exec -i "$DB" psql -U postgres -d postgres -q -t -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

expect_ok() {
  local d=$1 u=$2 s=$3 out
  out=$(as_user "$u" "$s" 2>&1)
  if [[ $? -eq 0 ]]; then ok "$d"; else bad "$d (expected success, got: $(grep -m1 ERROR <<<"$out"))"; fi
}

# A denial test that accepts ANY error is close to worthless — a typo in a
# column name would "pass" as a successful block. The error has to be the
# RIGHT error: an RLS denial, one of this schema's CHECK/FK/unique guards, or
# the freeze trigger's own message.
expect_deny() {
  local d=$1 u=$2 s=$3 out
  out=$(as_user "$u" "$s" 2>&1)
  if [[ $? -eq 0 ]]; then
    bad "$d (expected denial, but it SUCCEEDED)"
  elif grep -qiE 'row-level security|permission denied|violates row-level|violates check constraint|duplicate key value|violates foreign key constraint|rules are frozen|not found, or not yours|null value in column|violates not-null' <<<"$out"; then
    ok "$d"
  else
    bad "$d (blocked, but by the WRONG error: $(grep -m1 ERROR <<<"$out"))"
  fi
}

expect_eq() {
  local d=$1 u=$2 s=$3 want=$4
  local got; got=$(as_user "$u" "$s" | tr -d ' \n\r')
  if [[ "$got" == "$want" ]]; then ok "$d"; else bad "$d (expected $want, got '$got')"; fi
}

echo "==> Creating test users"
mk_user() {
  curl -s -X POST "$API/auth/v1/admin/users" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"TestPassword123!\",\"email_confirm\":true}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))'
}
STAMP=$(date +%s)
A=$(mk_user "prop_a_${STAMP}@journal4me.test")
B=$(mk_user "prop_b_${STAMP}@journal4me.test")
[[ -n "$A" && -n "$B" ]] || { echo "could not create test users — is the local stack running?"; exit 1; }
echo "    A=$A"
echo "    B=$B"

as_user "$A" "insert into public.accounts (user_id,name,account_type,starting_balance,currency) values ('$A','A prop','prop_firm',50000,'USD');" >/dev/null
A_ACCT=$(as_owner "select id from public.accounts where user_id='$A' limit 1;" | tr -d ' \n\r')

# Small helper: the id of one of A's profiles, by name.
pid() { as_owner "select id from public.prop_firm_profiles where user_id='$A' and profile_name='$1' and is_current order by version desc limit 1;" | tr -d ' \n\r'; }

# ===========================================================================
echo
echo "==> Acceptance test 8 — three firms, three drawdown variants, as DATA"
# ===========================================================================

# --- FTMO: static drawdown, percentage-based, 2 evaluation phases ----------
expect_ok "FTMO: profile" "$A" \
  "insert into public.prop_firm_profiles (user_id,firm_name,profile_name) values ('$A','FTMO','FTMO 100k Standard');"
FTMO=$(pid 'FTMO 100k Standard')
expect_ok "FTMO: phase 1 (10% target)" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,profit_target_pct,profit_target_basis,min_trading_days) values ('$A',$FTMO,1,'evaluation','Phase 1',10,'initial_balance',4);"
expect_ok "FTMO: phase 2 (5% target)" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,profit_target_pct,profit_target_basis,min_trading_days) values ('$A',$FTMO,2,'evaluation','Phase 2',5,'initial_balance',4);"
expect_ok "FTMO: funded phase (no target, 80% split, 14d wait)" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,min_days_before_first_withdrawal,profit_split_pct) values ('$A',$FTMO,3,'funded','Funded',14,80);"
expect_ok "FTMO: 5% daily loss, STATIC, off initial balance" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_pct,pct_basis,pct_basis_source,dd_basis,measure_series) values ('$A',$FTMO,null,'daily',5,'initial_balance','user_specified','static','closing_balance');"
expect_ok "FTMO: 10% overall loss, STATIC" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_pct,pct_basis,pct_basis_source,dd_basis,measure_series) values ('$A',$FTMO,null,'overall',10,'initial_balance','user_specified','static','closing_balance');"

# --- Topstep: trailing on CLOSING BALANCE, dollar-denominated, no lock -----
expect_ok "Topstep: profile" "$A" \
  "insert into public.prop_firm_profiles (user_id,firm_name,profile_name) values ('$A','Topstep','Topstep 50k Combine');"
TOPSTEP=$(pid 'Topstep 50k Combine')
expect_ok "Topstep: combine phase (\$3,000 target)" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,profit_target_amount,min_trading_days) values ('$A',$TOPSTEP,1,'evaluation','Trading Combine',3000,2);"
expect_ok "Topstep: funded phase" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,min_days_before_first_withdrawal,profit_split_pct) values ('$A',$TOPSTEP,2,'funded','Funded',5,90);"
expect_ok "Topstep: \$1,000 daily loss, STATIC, dollar not percent" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_amount,dd_basis,measure_series) values ('$A',$TOPSTEP,null,'daily',1000,'static','closing_balance');"
expect_ok "Topstep: \$2,000 overall, TRAILING on closing balance, no lock" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_amount,dd_basis,measure_series) values ('$A',$TOPSTEP,null,'overall',2000,'trailing','closing_balance');"
expect_ok "Topstep: 40% consistency rule, continuous" "$A" \
  "insert into public.consistency_rules (user_id,profile_id,label,max_share_pct,denominator,window_start,evaluated_at,applies_from) values ('$A',$TOPSTEP,'40% consistency',40,'net_profit','challenge_start','continuous','always');"

# --- Apex: trailing on INTRADAY EQUITY HIGH, locking $100 above start ------
# This is the one that decides whether the LEAST() model was right. The lock is
# a single nullable offset column, not a state machine and not a locked_at flag.
expect_ok "Apex: profile" "$A" \
  "insert into public.prop_firm_profiles (user_id,firm_name,profile_name) values ('$A','Apex','Apex 50k');"
APEX=$(pid 'Apex 50k')
expect_ok "Apex: evaluation phase" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,profit_target_amount) values ('$A',$APEX,1,'evaluation','Evaluation',3000);"
expect_ok "Apex: funded phase (8d wait, 100% split)" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,min_days_before_first_withdrawal,profit_split_pct) values ('$A',$APEX,2,'funded','Funded',8,100);"
expect_ok "Apex: \$2,500 TRAILING on intraday high, locks at start+\$100" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_amount,dd_basis,measure_series,trail_lock_cap_offset) values ('$A',$APEX,null,'overall',2500,'trailing','intraday_equity_high',100);"
expect_ok "Apex: 30% consistency, gates the WITHDRAWAL, funded only" "$A" \
  "insert into public.consistency_rules (user_id,profile_id,label,max_share_pct,denominator,window_start,evaluated_at,applies_from) values ('$A',$APEX,'30% consistency',30,'net_profit','last_withdrawal','withdrawal_request','funded_only');"

expect_eq "All three firms differ only in DATA (3 distinct dd shapes)" "$A" \
  "select count(distinct (dd_basis, measure_series, coalesce(trail_lock_cap_offset,-1))) from public.drawdown_rules where scope='overall';" "3"

# ===========================================================================
echo
echo "==> Acceptance test 8b — all four phase topologies"
# ===========================================================================
for spec in "3:3-phase" "2:2-phase" "1:1-phase"; do
  n=${spec%%:*}; label=${spec#*:}
  expect_ok "$label: profile" "$A" \
    "insert into public.prop_firm_profiles (user_id,firm_name,profile_name) values ('$A','Generic','Topology $label');"
  P=$(pid "Topology $label")
  for ((i=1; i<=n; i++)); do
    as_user "$A" "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,profit_target_pct,profit_target_basis) values ('$A',$P,$i,'evaluation','Phase $i',8,'initial_balance');" >/dev/null
  done
  as_user "$A" "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,profit_split_pct) values ('$A',$P,$((n+1)),'funded','Funded',80);" >/dev/null
  expect_eq "$label: $n evaluation + 1 funded" "$A" \
    "select count(*) filter (where phase_kind='evaluation')||'+'||count(*) filter (where phase_kind='funded') from public.phase_rules where profile_id=$P;" "$n+1"
done

# The one that catches a bad model: no phase to pass, no profit target at all,
# yet the account still carries consistency and payout-waiting rules from day
# one. Only representable because profit_target_* is nullable.
expect_ok "instant-funded: profile" "$A" \
  "insert into public.prop_firm_profiles (user_id,firm_name,profile_name) values ('$A','Generic','Topology instant');"
INSTANT=$(pid 'Topology instant')
expect_ok "instant-funded: ONE funded phase, NO profit target" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,label,min_days_before_first_withdrawal,profit_split_pct) values ('$A',$INSTANT,1,'funded','Funded',30,90);"
expect_ok "instant-funded: consistency binds from day one" "$A" \
  "insert into public.consistency_rules (user_id,profile_id,max_share_pct,denominator,window_start,evaluated_at,applies_from) values ('$A',$INSTANT,25,'net_profit','funded_start','withdrawal_request','funded_only');"
expect_eq "instant-funded: 0 evaluation phases" "$A" \
  "select count(*) from public.phase_rules where profile_id=$INSTANT and phase_kind='evaluation';" "0"

# ===========================================================================
echo
echo "==> Integrity guards"
# ===========================================================================
expect_deny "A rule with BOTH pct and amount is rejected" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,scope,limit_pct,limit_amount,pct_basis,pct_basis_source,dd_basis,measure_series) values ('$A',$INSTANT,'daily',5,1000,'initial_balance','user_specified','static','closing_balance');"
expect_deny "A rule with NEITHER pct nor amount is rejected" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,scope,dd_basis,measure_series) values ('$A',$INSTANT,'daily','static','closing_balance');"
expect_deny "A percentage limit with NO basis is rejected" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,scope,limit_pct,dd_basis,measure_series) values ('$A',$INSTANT,'daily',5,'static','closing_balance');"
expect_deny "A basis with no stated SOURCE is rejected" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,scope,limit_pct,pct_basis,dd_basis,measure_series) values ('$A',$INSTANT,'daily',5,'initial_balance','static','closing_balance');"
expect_deny "A lock cap on a STATIC rule is rejected" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,scope,limit_amount,dd_basis,measure_series,trail_lock_cap_offset) values ('$A',$INSTANT,'daily',500,'static','closing_balance',100);"
expect_deny "Withdrawal terms on an EVALUATION phase are rejected" "$A" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind,profit_split_pct) values ('$A',$INSTANT,9,'evaluation',80);"
expect_deny "Two 'all phases' overall rules on one profile conflict" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_amount,dd_basis,measure_series) values ('$A',$APEX,null,'overall',9999,'static','closing_balance');"

# The composite FK: a rule may only be pinned to a phase of its OWN profile.
FTMO_P1=$(as_owner "select id from public.phase_rules where profile_id=$FTMO and phase_order=1;" | tr -d ' \n\r')
expect_deny "A rule cannot be pinned to ANOTHER profile's phase" "$A" \
  "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_amount,dd_basis,measure_series) values ('$A',$APEX,$FTMO_P1,'daily',500,'static','closing_balance');"

# ===========================================================================
echo
echo "==> Freeze-on-first-use, and the clone that makes it livable"
# ===========================================================================
expect_ok "Rules are editable while the profile is unused" "$A" \
  "update public.phase_rules set label='Phase 1 (edited)' where profile_id=$FTMO and phase_order=1;"

expect_ok "A starts a challenge on the FTMO profile" "$A" \
  "insert into public.challenge_instances (user_id,account_id,profile_id,current_phase_id,starting_balance,started_on,current_phase_started_on) values ('$A',$A_ACCT,$FTMO,$FTMO_P1,50000,current_date,current_date);"
expect_deny "...and now its phases are FROZEN" "$A" \
  "update public.phase_rules set label='sneaky edit' where profile_id=$FTMO and phase_order=1;"
expect_deny "...its drawdown rules too" "$A" \
  "update public.drawdown_rules set limit_pct=99 where profile_id=$FTMO and scope='daily';"
expect_deny "...and a new rule cannot be slipped in" "$A" \
  "insert into public.consistency_rules (user_id,profile_id,max_share_pct,denominator,window_start,evaluated_at) values ('$A',$FTMO,50,'net_profit','challenge_start','continuous');"
expect_deny "...nor can a rule be deleted out of it" "$A" \
  "delete from public.drawdown_rules where profile_id=$FTMO and scope='daily';"
expect_deny "The in-use profile itself cannot be deleted" "$A" \
  "delete from public.prop_firm_profiles where id=$FTMO;"

# A phase-scoped rule on Topstep, so the clone's phase remapping is actually
# exercised rather than trivially copying NULLs.
TOPSTEP_P2=$(as_owner "select id from public.phase_rules where profile_id=$TOPSTEP and phase_order=2;" | tr -d ' \n\r')
as_user "$A" "insert into public.drawdown_rules (user_id,profile_id,phase_id,scope,limit_amount,dd_basis,measure_series) values ('$A',$TOPSTEP,$TOPSTEP_P2,'daily',800,'static','closing_balance');" >/dev/null

expect_ok "clone_profile_version() produces v2" "$A" \
  "select public.clone_profile_version($TOPSTEP, 'Feb 2026 rule change');"
TOPSTEP_V2=$(as_owner "select id from public.prop_firm_profiles where user_id='$A' and profile_name='Topstep 50k Combine' and version=2;" | tr -d ' \n\r')
expect_eq "v2 copied all 3 drawdown rules" "$A" \
  "select count(*) from public.drawdown_rules where profile_id=$TOPSTEP_V2;" "3"
expect_eq "v2 copied the consistency rule" "$A" \
  "select count(*) from public.consistency_rules where profile_id=$TOPSTEP_V2;" "1"
# The remap is the part that silently breaks: a naive copy would leave the
# cloned rule pointing at v1's phase row, so v2 would be judged partly under
# v1's rules.
expect_eq "v2's phase-scoped rule points at V2's OWN phase" "$A" \
  "select count(*) from public.drawdown_rules d join public.phase_rules p on p.id=d.phase_id where d.profile_id=$TOPSTEP_V2 and p.profile_id=$TOPSTEP_V2;" "1"
expect_eq "v1 was marked superseded" "$A" \
  "select is_current::text from public.prop_firm_profiles where id=$TOPSTEP;" "false"
expect_ok "v2 is editable (it is not in use yet)" "$A" \
  "update public.drawdown_rules set limit_amount=2500 where profile_id=$TOPSTEP_V2 and scope='overall';"

expect_deny "A second ACTIVE challenge on one account is blocked" "$A" \
  "insert into public.challenge_instances (user_id,account_id,profile_id,current_phase_id,starting_balance,started_on,current_phase_started_on) values ('$A',$A_ACCT,$APEX,(select id from public.phase_rules where profile_id=$APEX and phase_order=1),50000,current_date,current_date);"

# ===========================================================================
echo
echo "==> Cross-tenant isolation on the nine new tables"
# ===========================================================================
expect_eq "B sees NONE of A's profiles"      "$B" "select count(*) from public.prop_firm_profiles;" "0"
expect_eq "B sees NONE of A's phase rules"   "$B" "select count(*) from public.phase_rules;" "0"
expect_eq "B sees NONE of A's drawdown rules" "$B" "select count(*) from public.drawdown_rules;" "0"
expect_eq "B sees NONE of A's consistency rules" "$B" "select count(*) from public.consistency_rules;" "0"
expect_eq "B sees NONE of A's challenges"    "$B" "select count(*) from public.challenge_instances;" "0"

expect_deny "B cannot create a profile owned by A" "$B" \
  "insert into public.prop_firm_profiles (user_id,firm_name,profile_name) values ('$A','Stolen','Stolen profile');"
# The dangerous shape: B owns the ROW but points it at A's PROFILE. Row-level
# ownership alone would let B graft rules onto A's rulebook without ever
# reading it.
expect_deny "B cannot attach a phase to A's profile" "$B" \
  "insert into public.phase_rules (user_id,profile_id,phase_order,phase_kind) values ('$B',$APEX,1,'evaluation');"
expect_deny "B cannot attach a drawdown rule to A's profile" "$B" \
  "insert into public.drawdown_rules (user_id,profile_id,scope,limit_amount,dd_basis,measure_series) values ('$B',$APEX,'daily',100,'static','closing_balance');"
expect_deny "B cannot start a challenge on A's account" "$B" \
  "insert into public.challenge_instances (user_id,account_id,profile_id,current_phase_id,starting_balance,started_on,current_phase_started_on) values ('$B',$A_ACCT,$APEX,$FTMO_P1,50000,current_date,current_date);"
expect_eq "B's UPDATE against A's rules hits 0 rows" "$B" \
  "with u as (update public.drawdown_rules set limit_amount=1 where user_id='$A' returning 1) select count(*) from u;" "0"
expect_eq "B's DELETE against A's profiles hits 0 rows" "$B" \
  "with d as (delete from public.prop_firm_profiles where user_id='$A' returning 1) select count(*) from d;" "0"
expect_ok "A's rulebook survived B's attempts" "$A" \
  "select 1/(case when count(*) >= 3 then 1 else 0 end) from public.prop_firm_profiles where user_id='$A';"

# ===========================================================================
echo
echo "==> Evidence tables: grants, ownership, and the read-only breach log"
# ===========================================================================
expect_ok "A records an equity mark" "$A" \
  "insert into public.equity_marks (user_id,account_id,trading_day,peak_equity,trough_equity) values ('$A',$A_ACCT,current_date,51200,49850);"
expect_deny "An equity mark with no values at all is rejected" "$A" \
  "insert into public.equity_marks (user_id,account_id,trading_day) values ('$A',$A_ACCT,current_date - 1);"
expect_deny "A peak below its trough is rejected" "$A" \
  "insert into public.equity_marks (user_id,account_id,trading_day,peak_equity,trough_equity) values ('$A',$A_ACCT,current_date - 2,100,500);"
expect_ok "A reconciles against the firm's reported balance" "$A" \
  "insert into public.balance_reconciliations (user_id,account_id,as_of,firm_reported_balance,computed_balance) values ('$A',$A_ACCT,current_date,50410,50480);"
expect_ok "A records a withdrawal request" "$A" \
  "insert into public.withdrawals (user_id,account_id,amount,requested_on) values ('$A',$A_ACCT,1200,current_date);"
expect_deny "A paid withdrawal with no approval date is rejected" "$A" \
  "insert into public.withdrawals (user_id,account_id,amount,requested_on,paid_on,status) values ('$A',$A_ACCT,900,current_date,current_date,'paid');"
expect_eq "B sees NONE of A's equity marks" "$B" "select count(*) from public.equity_marks;" "0"
expect_eq "B sees NONE of A's reconciliations" "$B" "select count(*) from public.balance_reconciliations;" "0"
expect_eq "B sees NONE of A's withdrawals" "$B" "select count(*) from public.withdrawals;" "0"
expect_deny "B cannot mark equity on A's account" "$B" \
  "insert into public.equity_marks (user_id,account_id,trading_day,peak_equity) values ('$B',$A_ACCT,current_date,1);"

# breach_events is written only by the M6b reconciler. A hand-written row could
# claim a breach the trades do not support, which is the one thing this log
# exists to be trusted about.
CI=$(as_owner "select id from public.challenge_instances where user_id='$A' limit 1;" | tr -d ' \n\r')
expect_ok "A can READ the breach log" "$A" "select count(*) from public.breach_events;"
expect_deny "A cannot WRITE the breach log by hand" "$A" \
  "insert into public.breach_events (user_id,account_id,challenge_instance_id,rule_key,occurred_on,severity,snapshot) values ('$A',$A_ACCT,$CI,'daily_loss',current_date,'breach','{}'::jsonb);"

echo
if [[ $fail -eq 0 ]]; then
  printf '\033[32m%d passed, 0 failed\033[0m\n' "$pass"
else
  printf '\033[31m%d passed, %d FAILED\033[0m\n' "$pass" "$fail"
fi
exit $(( fail > 0 ? 1 : 0 ))
