#!/usr/bin/env bash
#
# Cross-tenant isolation and entitlement enforcement test.
#
# This is the most important test in the repo. Everything else being correct
# still ships a catastrophe if one user can read another user's trading
# history, and RLS failures are silent by nature — a missing policy does not
# throw, it just returns rows it should not have.
#
# It also covers the `42501` class of bug: since the hardening migration a new
# table starts with ZERO privileges for `authenticated`, so a migration that
# forgets its GRANTs fails here rather than in production.
#
# Runs against the LOCAL stack only. Usage:  ./scripts/rls-test.sh
set -uo pipefail

API=${SUPABASE_API_URL:-http://127.0.0.1:54321}
KEY=${SUPABASE_SERVICE_KEY:-sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz}
DB=${SUPABASE_DB_CONTAINER:-supabase_db_journal4me}

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }

# Run SQL as a specific user, with RLS applied.
# Superusers bypass RLS entirely, so `set role authenticated` is what makes
# this test meaningful at all — without it every policy would appear to pass.
as_user() {
  local uid=$1; shift
  docker exec -i "$DB" psql -U postgres -d postgres -q -t -v ON_ERROR_STOP=1 <<SQL 2>&1
set request.jwt.claims = '{"sub":"$uid","role":"authenticated"}';
set role authenticated;
$*
SQL
}

expect_ok() {
  local d=$1 u=$2 s=$3 out
  out=$(as_user "$u" "$s" 2>&1)
  if [[ $? -eq 0 ]]; then ok "$d"; else bad "$d (expected success, got: $(head -1 <<<"$out"))"; fi
}

# A denial test that accepts ANY error is close to worthless: a typo in a table
# name would "pass" as a successful block. The error must be the RIGHT error —
# an RLS denial, a CHECK violation, or one of our own guards — not a SQL mistake.
#
# "not found or not yours" comes from stamp_account_ledger(). That trigger runs
# SECURITY INVOKER, so its accounts lookup is RLS-filtered and someone else's
# account simply is not there. It fires before the RLS policy is evaluated, so
# cross-account writes are blocked twice over: trigger first, policy behind it.
expect_deny() {
  local d=$1 u=$2 s=$3 out
  out=$(as_user "$u" "$s" 2>&1)
  if [[ $? -eq 0 ]]; then
    bad "$d (expected denial, but it SUCCEEDED)"
  elif grep -qiE 'row-level security|permission denied|violates row-level|Unknown timezone|violates check constraint|duplicate key value|not found or not yours|Plan limit exceeded' <<<"$out"; then
    ok "$d"
  else
    bad "$d (blocked, but by the WRONG error: $(grep -m1 ERROR <<<"$out"))"
  fi
}
# Run SQL as the DB owner, bypassing RLS. Used only to set up an attack the
# attacker could not stage themselves.
as_owner() { docker exec -i "$DB" psql -U postgres -d postgres -q -t -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

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
A=$(mk_user "rls_a_$(date +%s)@journal4me.test")
B=$(mk_user "rls_b_$(date +%s)@journal4me.test")
# C is used only for the bulk-insert quota tests below, kept separate from A/B
# so those assertions never depend on how many rows A or B have accumulated
# earlier in the script.
C=$(mk_user "rls_c_$(date +%s)@journal4me.test")
[[ -n "$A" && -n "$B" && -n "$C" ]] || { echo "could not create test users — is the local stack running?"; exit 1; }
echo "    A=$A"
echo "    B=$B"
echo "    C=$C"

echo
echo "==> Entitlements (free plan: 1 personal, 1 prop)"
expect_ok   "A: 1st personal account allowed"      "$A" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$A','A personal','personal',10000);"
expect_deny "A: 2nd personal account BLOCKED"      "$A" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$A','A personal 2','personal',10000);"
expect_ok   "A: 1st prop account allowed (separate limit)" "$A" "insert into public.accounts (user_id,name,account_type,starting_balance,reset_timezone,reset_time,day_label_offset) values ('$A','A prop','prop_firm',100000,'America/New_York','17:00',1);"
expect_deny "A: 2nd prop account BLOCKED"          "$A" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$A','A prop 2','prop_firm',50000);"

echo
echo "==> Timezone validation"
expect_deny "Numeric offset 'GMT+2' rejected"      "$A" "insert into public.accounts (user_id,name,account_type,reset_timezone) values ('$A','bad tz','personal','GMT+2');"

echo
echo "==> Cross-tenant isolation"
expect_eq   "A sees only its own 2 accounts"       "$A" "select count(*) from public.accounts;" "2"
expect_eq   "B sees NONE of A's accounts"          "$B" "select count(*) from public.accounts;" "0"
expect_deny "B cannot insert a row owned by A"     "$B" "insert into public.accounts (user_id,name,account_type) values ('$A','stolen','personal');"
expect_eq   "B's UPDATE against A's rows hits 0"   "$B" "with u as (update public.accounts set name='hijacked' where user_id='$A' returning 1) select count(*) from u;" "0"
expect_eq   "B's DELETE against A's rows hits 0"   "$B" "with d as (delete from public.accounts where user_id='$A' returning 1) select count(*) from d;" "0"
expect_eq   "A's rows survived B's attempts"       "$A" "select count(*) from public.accounts;" "2"
expect_ok   "B has its own independent limit"      "$B" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$B','B personal','personal',500);"

echo
echo "==> Archiving frees a plan slot"
expect_ok   "A archives its personal account"      "$A" "update public.accounts set is_archived=true where user_id='$A' and account_type='personal';"
expect_ok   "A can now create another personal"    "$A" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$A','A personal fresh','personal',2000);"

echo
echo "==> Ledger"
expect_ok   "A adds a commission to its own account"  "$A" "insert into public.account_ledger (user_id,account_id,kind,amount) select '$A', id, 'commission', -4 from public.accounts where user_id='$A' and account_type='prop_firm';"
expect_eq   "ledger row got a trading_day stamped"    "$A" "select count(*) from public.account_ledger where trading_day is not null;" "1"
expect_deny "A cannot log a POSITIVE payout"          "$A" "insert into public.account_ledger (user_id,account_id,kind,amount) select '$A', id, 'withdrawal_payout', 2000 from public.accounts where user_id='$A' and account_type='prop_firm';"
expect_eq   "B sees none of A's ledger"               "$B" "select count(*) from public.account_ledger;" "0"
# The dangerous case: B owns the ROW but points it at A's ACCOUNT. Row-level
# ownership alone would let B corrupt A's balance without ever reading it.
#
# The account id is fetched as the DB owner on purpose. An earlier version of
# this test had B select the id itself, which returns nothing under RLS — so
# the INSERT touched 0 rows and "passed" without ever attempting the attack.
# A denial test that cannot reach the thing it is testing proves nothing.
A_ACCT=$(as_owner "select id from public.accounts where user_id='$A' and account_type='prop_firm' limit 1;" | tr -d ' \n\r')
expect_deny "B cannot attach a ledger row to A's account (id $A_ACCT)" "$B" "insert into public.account_ledger (user_id,account_id,kind,amount) values ('$B',$A_ACCT,'commission',-999);"
expect_deny "B cannot forge a ledger row AS A"        "$B" "insert into public.account_ledger (user_id,account_id,kind,amount) values ('$A',$A_ACCT,'commission',-999);"
expect_eq   "A's ledger untouched by B"               "$A" "select count(*) from public.account_ledger;" "1"

echo
echo "==> Trades"
A_ACCT2=$(as_owner "select id from public.accounts where user_id='$A' and account_type='prop_firm' limit 1;" | tr -d ' \n\r')
expect_ok   "A logs a trade on its own account"       "$A" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,stop_loss_price,size,entry_time,exit_time,exit_price,pnl) values ('$A',$A_ACCT2,'ES','long',100,98,10,now()-interval '2 hours',now(),104,40);"
expect_eq   "r_multiple computed (40 / (2*10) = 2)"   "$A" "select round(r_multiple,4) from public.trades where symbol='ES';" "2.0000"
expect_eq   "open_day stamped"                        "$A" "select count(*) from public.trades where open_day is not null;" "1"
expect_deny "stop on the wrong side is rejected"      "$A" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,stop_loss_price,size,entry_time) values ('$A',$A_ACCT2,'BAD','long',100,105,1,now());"
expect_deny "exit_time without pnl is rejected"       "$A" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time,exit_time) values ('$A',$A_ACCT2,'BAD2','long',100,1,now(),now());"
expect_eq   "B sees none of A's trades"               "$B" "select count(*) from public.trades;" "0"
expect_deny "B cannot log a trade on A's account"     "$B" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time) values ('$B',$A_ACCT2,'STEAL','long',100,1,now());"

echo
echo "==> Strategies"
expect_ok   "A creates a strategy with a checklist" "$A" "insert into public.strategies (user_id,name,entry_criteria) values ('$A','ORB Breakout', array['HTF trend aligned','waited for retest']);"
expect_eq   "B sees none of A's strategies"          "$B" "select count(*) from public.strategies;" "0"
A_STRAT=$(as_owner "select id from public.strategies where user_id='$A' limit 1;" | tr -d ' \n\r')
expect_ok   "A tags its own trade with its own strategy" "$A" "insert into public.trades (user_id,account_id,strategy_id,symbol,direction,entry_price,size,entry_time) values ('$A',$A_ACCT2,$A_STRAT,'STRAT','long',100,1,now());"
# The real attack: B holds A's REAL strategy id (fetched as the DB owner, since
# B cannot read it under RLS) and tries to tag its OWN trade with it. A test
# where B looks up the id itself would silently attempt 0 rows and prove
# nothing — the id must come from outside the attacker's own visibility.
B_ACCT_FOR_STRAT=$(as_owner "select id from public.accounts where user_id='$B' limit 1;" | tr -d ' \n\r')
expect_deny "B cannot tag its trade with A's strategy_id" "$B" "insert into public.trades (user_id,account_id,strategy_id,symbol,direction,entry_price,size,entry_time) values ('$B',$B_ACCT_FOR_STRAT,$A_STRAT,'STEAL','long',100,1,now());"

echo
echo "==> Monthly trade quota (free = 30)"
# A already has 2 trades logged (from the Trades and Strategies blocks above),
# so 28 more lands exactly at the 30-trade cap. This number is deliberately
# exact rather than "enough to be over": the statement-level trigger added
# below now correctly REJECTS a bulk insert that overshoots the cap in one
# statement, so this must land AT the boundary, not past it.
expect_ok   "A fills up to the 30-trade cap (2 existing + 28 more)" "$A" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time) select '$A',$A_ACCT2,'F'||g,'long',100,1,now() from generate_series(1,28) g;"
expect_deny "the 31st trade is blocked"               "$A" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time) values ('$A',$A_ACCT2,'OVER','long',100,1,now());"
expect_ok   "editing an existing trade still works at the cap" "$A" "update public.trades set notes='fixed' where symbol='ES';"

echo
echo "==> Storage (path-scoped, a different RLS mechanism)"
# Checked as the DB owner: `authenticated` deliberately cannot read
# storage.buckets at all (RLS on, no policies), so a client cannot enumerate
# buckets. Asserted separately below.
BUCKET_PUBLIC=$(as_owner "select public::text from storage.buckets where id='trade-screenshots';" | tr -d ' \n\r')
if [[ "$BUCKET_PUBLIC" == "false" ]]; then ok "bucket is PRIVATE"; else bad "bucket is PRIVATE (got '$BUCKET_PUBLIC')"; fi
expect_eq   "clients cannot enumerate buckets"        "$A" "select count(*) from storage.buckets;" "0"
expect_ok   "A uploads into its own folder"           "$A" "insert into storage.objects (bucket_id,name) values ('trade-screenshots','$A/1/setup.png');"
expect_deny "A cannot upload into B's folder"         "$A" "insert into storage.objects (bucket_id,name) values ('trade-screenshots','$B/1/steal.png');"
expect_eq   "B sees none of A's objects"              "$B" "select count(*) from storage.objects where bucket_id='trade-screenshots';" "0"
expect_eq   "B cannot rename A's file into its folder" "$B" "with u as (update storage.objects set name='$B/1/stolen.png' where bucket_id='trade-screenshots' returning 1) select count(*) from u;" "0"
expect_eq   "A's object survived"                     "$A" "select count(*) from storage.objects where bucket_id='trade-screenshots';" "1"

echo
echo "==> Screenshot metadata"
A_TRADE=$(as_owner "select id from public.trades where user_id='$A' and symbol='ES' limit 1;" | tr -d ' \n\r')
expect_ok   "A links a screenshot to its own trade"   "$A" "insert into public.trade_screenshots (user_id,trade_id,storage_path) values ('$A',$A_TRADE,'$A/1/setup.png');"
expect_deny "path must start with the owner's id"     "$A" "insert into public.trade_screenshots (user_id,trade_id,storage_path) values ('$A',$A_TRADE,'$B/1/wrong.png');"
expect_deny "B cannot attach a screenshot to A's trade" "$B" "insert into public.trade_screenshots (user_id,trade_id,storage_path) values ('$B',$A_TRADE,'$B/1/x.png');"
expect_eq   "B sees none of A's screenshots"          "$B" "select count(*) from public.trade_screenshots;" "0"

echo
echo "==> Journal entries"
expect_ok   "A writes today's journal entry"         "$A" "insert into public.journal_entries (user_id,entry_date,pre_market_plan) values ('$A','2026-03-03','watch ES open');"
expect_ok   "A edits the same day's entry"            "$A" "update public.journal_entries set post_session_review='worked' where user_id='$A' and entry_date='2026-03-03';"
expect_deny "a second entry for the same day is rejected" "$A" "insert into public.journal_entries (user_id,entry_date,pre_market_plan) values ('$A','2026-03-03','duplicate');"
expect_eq   "B sees none of A's journal"              "$B" "select count(*) from public.journal_entries;" "0"
expect_deny "B cannot write a journal entry as A"     "$B" "insert into public.journal_entries (user_id,entry_date,pre_market_plan) values ('$A','2026-04-01','forged');"

echo
echo "==> Bulk-insert quota bypass (statement-level enforcement)"
# own_active_account_count()/own_trade_count_this_month() are STABLE, so a
# single multi-row INSERT sees one snapshot for the whole statement — every
# row's WITH CHECK reads the SAME pre-statement count. A row-level RLS check
# alone cannot catch this; it was caught here empirically (5 accounts landed
# against a cap of 1, 42 trades against a cap of 30) before the statement-level
# triggers now enforcing this were added. These assertions are the regression
# guard, run against a FRESH user (C) so they never depend on how many rows A
# or B have accumulated earlier in this script.
expect_deny "bulk-inserting 5 accounts against a cap of 1 is rejected" "$C" "insert into public.accounts (user_id,name,account_type,starting_balance) select '$C','BulkAcct'||g,'personal',1000 from generate_series(1,5) g;"
expect_eq   "the whole batch rolled back, not just the excess"        "$C" "select count(*) from public.accounts where user_id='$C';" "0"
expect_ok   "C opens its one allowed personal account"                "$C" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$C','C Personal','personal',1000);"
C_ACCT=$(as_owner "select id from public.accounts where user_id='$C' limit 1;" | tr -d ' \n\r')
expect_ok   "a bulk insert of trades that STAYS under the cap succeeds"     "$C" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time) select '$C',$C_ACCT,'OK'||g,'long',100,1,now() from generate_series(1,5) g;"
expect_deny "bulk-inserting 50 more trades in one statement is rejected"    "$C" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time) select '$C',$C_ACCT,'OVERBULK'||g,'long',100,1,now() from generate_series(1,50) g;"
expect_eq   "the 50-row batch rolled back — C still at exactly 5"          "$C" "select count(*) from public.trades where user_id='$C';" "5"

echo
echo "==> account_balance() — money math gets checked too"
# Reuses C's account from the bulk-insert block above, deliberately: C's only
# activity there was 5 trades with no exit_time/pnl (still open), so the
# balance must be EXACTLY the starting balance with nothing else touching it —
# unlike A's accounts, which already carry a realised trade and a commission
# from earlier blocks and would make the expected number a moving target.
expect_eq   "starting balance, only OPEN trades so far (unaffected)" "$C" "select public.account_balance($C_ACCT);" "1000"
expect_ok   "C adds a -300 ledger movement"            "$C" "insert into public.account_ledger (user_id,account_id,kind,amount) values ('$C',$C_ACCT,'withdrawal_payout',-300);"
expect_eq   "balance reflects the ledger movement"     "$C" "select public.account_balance($C_ACCT);" "700"
expect_eq   "B cannot read C's balance (null, not an error or 0)" "$B" "select coalesce(public.account_balance($C_ACCT)::text,'NULL');" "NULL"

echo
echo "==> Unarchive / relabel quota bypass (a second statement-level gap)"
# The INSERT-side fix above does not cover this: archive -> create -> archive
# again legitimately leaves 2 archived personal accounts under a cap of 1,
# and unarchiving BOTH in one UPDATE used to slip through, because
# accounts_update_own never re-checked the plan limit at all — only INSERT
# did. A second trigger (after every UPDATE) closes it. Uses a fresh user (E)
# so it is not coupled to C's state from the block above.
E=$(mk_user "rls_e_$(date +%s)@journal4me.test")
expect_ok   "E creates and archives a personal account (P1)"  "$E" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$E','P1','personal',1000); update public.accounts set is_archived=true where user_id='$E' and name='P1';"
expect_ok   "E creates and archives a second one (P2)"        "$E" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$E','P2','personal',1000); update public.accounts set is_archived=true where user_id='$E' and name='P2';"
expect_deny "unarchiving BOTH in one statement is rejected"   "$E" "update public.accounts set is_archived=false where user_id='$E' and account_type='personal';"
expect_eq   "the batch rolled back — E still has 0 active"    "$E" "select count(*) from public.accounts where user_id='$E' and not is_archived;" "0"
expect_ok   "unarchiving just ONE stays within the cap"       "$E" "update public.accounts set is_archived=false where user_id='$E' and name='P1';"
expect_ok   "E opens a prop_firm account too (separate bucket)" "$E" "insert into public.accounts (user_id,name,account_type,starting_balance) values ('$E','Prop A','prop_firm',50000);"
expect_deny "relabelling prop_firm -> personal to launder capacity is rejected" "$E" "update public.accounts set account_type='personal' where user_id='$E' and name='Prop A';"
expect_ok   "an ordinary rename (no cap change) still works"  "$E" "update public.accounts set name='P1 renamed' where user_id='$E' and name='P1';"

echo
echo "==> push_subscriptions (M7b)"
F=$(mk_user "rls_f_$(date +%s)@journal4me.test")
expect_ok   "F subscribes device 1"                     "$F" "select public.save_push_subscription('https://push.example/f1','p256dh-f1','auth-f1','Chrome/1');"
expect_eq   "F sees exactly 1 subscription"              "$F" "select count(*) from public.push_subscriptions where user_id='$F';" "1"
expect_ok   "F subscribes device 2 (a second device)"    "$F" "select public.save_push_subscription('https://push.example/f2','p256dh-f2','auth-f2','Safari/1');"
expect_eq   "F now has 2 — one row per device, not one per user" "$F" "select count(*) from public.push_subscriptions where user_id='$F';" "2"
expect_ok   "re-subscribing device 1 upserts, not duplicates" "$F" "select public.save_push_subscription('https://push.example/f1','p256dh-f1-NEW','auth-f1','Chrome/2');"
expect_eq   "still 2 rows, not 3"                         "$F" "select count(*) from public.push_subscriptions where user_id='$F';" "2"
expect_eq   "...and the upsert really updated the keys"   "$F" "select p256dh from public.push_subscriptions where endpoint='https://push.example/f1';" "p256dh-f1-NEW"
expect_eq   "B sees NONE of F's subscriptions"            "$B" "select count(*) from public.push_subscriptions;" "0"
expect_deny "B cannot insert a subscription owned by F"   "$B" "insert into public.push_subscriptions (user_id,endpoint,p256dh,auth_key) values ('$F','https://push.example/stolen','x','y');"
expect_eq   "B's DELETE against F's subscriptions hits 0" "$B" "with d as (delete from public.push_subscriptions where user_id='$F' returning 1) select count(*) from d;" "0"
# The shared-device case the update policy exists for: G re-subscribes the
# EXACT SAME endpoint F already registered (e.g. F signed out on a shared
# laptop and G signed in). The row must reassign to G, not stay F's forever.
G=$(mk_user "rls_g_$(date +%s)@journal4me.test")
expect_ok   "G re-subscribes F's exact endpoint (shared device)" "$G" "select public.save_push_subscription('https://push.example/f1','p256dh-g','auth-g','Chrome/3');"
expect_eq   "that row now belongs to G, not F"            "$G" "select user_id::text from public.push_subscriptions where endpoint='https://push.example/f1';" "$G"
expect_eq   "F is left with only device 2"                "$F" "select count(*) from public.push_subscriptions where user_id='$F';" "1"
expect_deny "G cannot hand its OWN row to a third user via a raw UPDATE" "$G" "update public.push_subscriptions set user_id='$B' where endpoint='https://push.example/f1';"
expect_eq   "...the row is still G's after the attempt"   "$G" "select user_id::text from public.push_subscriptions where endpoint='https://push.example/f1';" "$G"

echo
echo "==> notifications (M7c)"
H=$(mk_user "rls_h_$(date +%s)@journal4me.test")
as_owner "insert into public.notifications (user_id, kind, title, body, dedupe_key) values ('$H','test','Test title','Test body','manual-test-1');" >/dev/null
NOTE_ID=$(as_owner "select id from public.notifications where dedupe_key='manual-test-1';" | tr -d ' \n\r')
expect_deny "H cannot INSERT a notification directly" "$H" "insert into public.notifications (user_id, kind, title, body, dedupe_key) values ('$H','test','sneaky','sneaky','manual-test-2');"
expect_eq   "H can read the system-written notification" "$H" "select count(*) from public.notifications where user_id='$H';" "1"
expect_ok   "H can mark it read (the one column grant allows it)" "$H" "update public.notifications set read_at = now() where id=$NOTE_ID;"
expect_deny "H cannot edit the TITLE via the same route (no column grant)" "$H" "update public.notifications set title='edited' where id=$NOTE_ID;"
expect_deny "H cannot DELETE a notification (no delete grant)" "$H" "delete from public.notifications where id=$NOTE_ID;"
expect_eq   "B sees NONE of H's notifications" "$B" "select count(*) from public.notifications;" "0"
expect_deny "rule_notification_state is invisible even to its owner (zero grants)" "$H" "select count(*) from public.rule_notification_state;"

echo
echo "==> Reference data"
expect_eq   "plans readable by a signed-in user"   "$A" "select count(*) from public.plans;" "2"
expect_eq   "subscriptions table readable, empty"  "$A" "select count(*) from public.subscriptions;" "0"
expect_deny "user cannot grant themselves a plan"  "$A" "insert into public.subscriptions (user_id,plan_id) values ('$A',(select id from public.plans where code='pro'));"

echo
printf '==> %d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]] || exit 1
