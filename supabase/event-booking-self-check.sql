alter table public.events
  drop constraint events_booking_status_check,
  add constraint events_booking_status_check check (
    booking_status in ('walkin', 'open', 'waitlist', 'upcoming', 'full', 'cancelled', 'check')
  );

create or replace function public.update_hosted_event_booking(p_event_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or p_status is null
    or p_status not in ('walkin', 'open', 'waitlist', 'upcoming', 'full', 'cancelled', 'check') then
    return false;
  end if;

  update public.events as e
  set booking_status = p_status, booking_checked_at = now()
  where e.id = p_event_id
    and e.author_id = (select auth.uid())
    and e.shared_organizer is null
    and e.status = 'approved'
    and (p_status <> 'check' or e.link ~ '^https?://[^[:space:]]+$')
    and exists (
      select 1 from public.profiles p
      where p.id = e.author_id and p.account_type = 'organization' and p.suspended is not true
    );
  return found;
end;
$function$;
