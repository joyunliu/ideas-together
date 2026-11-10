create table public.event_registrations (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  slot_key text not null default '',
  primary key (user_id, event_id, slot_key),
  constraint event_registration_slot_key check (
    slot_key = '' or slot_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$'
  )
);

create index event_registrations_event_id_idx on public.event_registrations (event_id);

alter table public.event_registrations enable row level security;

revoke all on table public.event_registrations from public, anon, authenticated;
grant select, insert, delete on table public.event_registrations to authenticated;

create policy "Read own registrations" on public.event_registrations
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Mark own registration for published events" on public.event_registrations
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and not (select public.is_suspended())
    and exists (select 1 from public.events e where e.id = event_id and e.status = 'approved')
  );

create policy "Remove own registrations" on public.event_registrations
  for delete to authenticated using (user_id = (select auth.uid()));
