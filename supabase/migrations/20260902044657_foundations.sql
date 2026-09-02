-- Foundations: helpers every later migration depends on.
--
-- Kept in its own migration because these are referenced by triggers and
-- policies across the whole schema; a later migration failing to find one of
-- them would be a confusing "function does not exist" rather than an obvious
-- ordering problem.

-- --------------------------------------------------------------------------
-- updated_at maintenance
-- --------------------------------------------------------------------------
-- A column the application sets by hand drifts the moment one write path
-- forgets it, and "when did this row last change" then silently lies. A
-- trigger cannot be forgotten by a caller.
--
-- search_path is pinned because this runs as the table owner in a trigger
-- context; an unpinned path would let a caller-controlled schema shadow the
-- names used inside.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: stamps updated_at on every UPDATE. Attach as a BEFORE UPDATE ... FOR EACH ROW trigger.';
