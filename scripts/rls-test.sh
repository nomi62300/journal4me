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
  elif grep -qiE 'row-level security|permission denied|violates row-level|Unknown timezone|violates check constraint|duplicate key value|not found or not yours' <<<"$out"; then
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
[[ -n "$A" && -n "$B" ]] || { echo "could not create test users — is the local stack running?"; exit 1; }
echo "    A=$A"
echo "    B=$B"

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
echo "==> Monthly trade quota (free = 30)"
expect_ok   "A fills up to the 30-trade cap"          "$A" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time) select '$A',$A_ACCT2,'F'||g,'long',100,1,now() from generate_series(1,29) g;"
expect_deny "the 31st trade is blocked"               "$A" "insert into public.trades (user_id,account_id,symbol,direction,entry_price,size,entry_time) values ('$A',$A_ACCT2,'OVER','long',100,1,now());"
expect_ok   "editing an existing trade still works at the cap" "$A" "update public.trades set notes='fixed' where symbol='ES';"

echo
echo "==> Reference data"
expect_eq   "plans readable by a signed-in user"   "$A" "select count(*) from public.plans;" "2"
expect_eq   "subscriptions table readable, empty"  "$A" "select count(*) from public.subscriptions;" "0"
expect_deny "user cannot grant themselves a plan"  "$A" "insert into public.subscriptions (user_id,plan_id) values ('$A',(select id from public.plans where code='pro'));"

echo
printf '==> %d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]] || exit 1
