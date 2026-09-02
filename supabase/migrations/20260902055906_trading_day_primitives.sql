-- Trading-day bucketing: the primitive the whole rule engine sits on.
--
-- Built before any table that stores a trade, because getting it wrong means
-- re-stamping every row in the database later. Nothing else in this schema is
-- as expensive to change after the fact.
--
-- THE PROBLEM
--
-- A prop firm's "daily loss limit" resets at the FIRM's time, not the user's
-- midnight and not UTC midnight. Futures firms commonly reset at 17:00 New
-- York; MT5 brokers reset at their server's midnight, which is usually some
-- flavour of Eastern Europe. A trader in Karachi on a 17:00-ET account has a
-- "today" offset from their own calendar day by most of a day.
--
-- Get the boundary wrong in one direction and two sessions merge into one
-- bucket, manufacturing a daily-loss breach that never happened. Get it wrong
-- in the other and one session splits across two buckets, hiding a real one.
-- Both failures look like arithmetic bugs and are actually calendar bugs.
--
-- THE SHAPE
--
--   trading_day = ((instant seen in the firm's zone) - reset) as a date
--                 + label_offset
--
-- `label_offset` exists because the CME convention labels the session that
-- OPENS on Monday evening as Tuesday's session. Without it the subtraction
-- alone would call it Monday.

create schema if not exists prop;
comment on schema prop is
  'Prop firm rule engine: trading-day bucketing, drawdown floors, rule status.';

grant usage on schema prop to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- prop.trading_day
-- --------------------------------------------------------------------------
-- IMMUTABLE is correct here and was verified rather than assumed: Postgres
-- marks `timezone(text, timestamptz)` -- the two-argument form, where the zone
-- is passed explicitly -- as IMMUTABLE. Only the single-argument variants are
-- STABLE, because those depend on the session's TimeZone setting. Since the
-- zone is always an argument here, nothing about this function varies with
-- session state, so it can back an index and be used in a generated column.
--
-- DST needs no special handling. Doing the subtraction in local time means a
-- 23-hour or 25-hour trading day falls out correctly by construction -- that
-- IS the day the firm operated.
create or replace function prop.trading_day(
  ts            timestamptz,
  tz            text,
  reset         time,
  label_offset  smallint default 0
)
returns date
language sql
immutable
parallel safe
as $$
  select (((ts at time zone tz) - reset::interval)::date + label_offset::int);
$$;

comment on function prop.trading_day(timestamptz, text, time, smallint) is
  'Bucket an instant into a firm trading day. tz is an IANA name; reset is the firm''s daily reset time; label_offset=1 labels the session opening after reset as the NEXT date (CME convention).';

-- --------------------------------------------------------------------------
-- prop.is_valid_timezone
-- --------------------------------------------------------------------------
-- Reads pg_timezone_names, so it is STABLE and therefore CANNOT be used in a
-- CHECK constraint (those require IMMUTABLE). Timezone columns are validated
-- by trigger instead -- see the accounts migration.
--
-- Storing an IANA name rather than a numeric offset is not a preference. An
-- MT5 broker advertising "GMT+2" actually runs GMT+3 through the summer, and
-- some follow US rather than EU transition dates. A stored offset is wrong for
-- months of the year and produces phantom daily-loss breaches at the boundary.
create or replace function prop.is_valid_timezone(tz text)
returns boolean
language sql
stable
parallel safe
as $$
  select exists (select 1 from pg_timezone_names where name = tz);
$$;

comment on function prop.is_valid_timezone(text) is
  'True if tz is a known IANA zone name. STABLE (reads pg_timezone_names), so it cannot be used in a CHECK constraint -- validate by trigger.';

grant execute on function prop.trading_day(timestamptz, text, time, smallint)
  to authenticated, service_role;
grant execute on function prop.is_valid_timezone(text)
  to authenticated, service_role;
