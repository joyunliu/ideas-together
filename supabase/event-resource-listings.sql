alter table public.events
  add column listing_type text check (listing_type in ('event', 'exhibition', 'resource')),
  add column visit_note text check (visit_note is null or char_length(visit_note) between 1 and 240),
  add column related_exhibition_id uuid references public.events(id) on delete set null,
  add constraint events_related_exhibition_not_self check (related_exhibition_id <> id);

create index events_related_exhibition_idx on public.events (related_exhibition_id)
  where related_exhibition_id is not null;
