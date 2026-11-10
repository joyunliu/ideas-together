create schema if not exists private;

create table private.event_link_fetch_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day date not null,
  uses integer not null
);

create function public.claim_event_link_fetch()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
begin
  if caller is null or not exists (
    select 1 from public.profiles p where p.id = caller and p.suspended is not true
  ) then
    return false;
  end if;

  insert into private.event_link_fetch_limits as limits(user_id, day, uses)
    values (caller, today, 1)
    on conflict (user_id) do update
    set day = excluded.day,
        uses = case when limits.day = excluded.day then limits.uses + 1 else 1 end
    where limits.day <> excluded.day or limits.uses < 10;
  return found;
end;
$$;
revoke execute on function public.claim_event_link_fetch() from public, anon;
grant execute on function public.claim_event_link_fetch() to authenticated;
