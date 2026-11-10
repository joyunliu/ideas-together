create table public.event_import_suggestions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_name text not null check (char_length(source_name) between 1 and 100),
  source_url text not null check (source_url ~ '^https?://[^[:space:]]+$' and char_length(source_url) <= 1000),
  changes jsonb not null default '{}'::jsonb,
  base_record jsonb not null,
  suggested_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  constraint event_import_changes_valid check (
    jsonb_typeof(changes) = 'object' and
    changes - array['title', 'description', 'start_at', 'end_at', 'city', 'district', 'venue', 'address', 'age_min', 'age_max', 'fee', 'fee_note', 'link', 'map_link', 'audience', 'flex_time', 'dates', 'continuous', 'schedule', 'shared_organizer', 'series_booking', 'recurrence_note', 'age_detail', 'age_min_month', 'age_max_month', 'booking_status', 'booking_checked_at', 'listing_type', 'visit_note', 'related_exhibition_id']::text[] = '{}'::jsonb
  )
);

create index event_import_suggestions_event_idx on public.event_import_suggestions(event_id);
create unique index event_import_suggestions_one_open_per_event
  on public.event_import_suggestions(event_id) where published_at is null;
create index event_import_suggestions_open_date
  on public.event_import_suggestions(suggested_at desc) where published_at is null;

alter table public.event_import_suggestions enable row level security;
revoke all on public.event_import_suggestions from public, anon, authenticated;
grant select, insert, update on public.event_import_suggestions to authenticated;

create policy "Active administrators manage event suggestions" on public.event_import_suggestions
  for all to authenticated
  using ((select public.is_admin()) and not (select public.is_suspended()))
  with check ((select public.is_admin()) and not (select public.is_suspended()));

create function public.snapshot_event_import_suggestion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_event public.events;
begin
  select * into current_event from public.events where id = new.event_id for share;
  if not found or (new.changes = '{}'::jsonb and current_event.status <> 'pending')
    or (new.changes <> '{}'::jsonb and current_event.status <> 'approved') then
    raise exception '活動狀態已變更，請重新整理建議清單。';
  end if;

  new.base_record := to_jsonb(current_event) - 'view_count';
  new.suggested_at := now();
  return new;
end;
$$;
revoke execute on function public.snapshot_event_import_suggestion() from public, anon, authenticated;
create trigger event_import_suggestion_snapshot
  before insert or update of changes, source_name, source_url on public.event_import_suggestions
  for each row execute function public.snapshot_event_import_suggestion();

create function public.publish_event_import_suggestions(p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  suggestion public.event_import_suggestions;
  current_event public.events;
  proposed public.events;
  published integer := 0;
begin
  if (select auth.uid()) is null or not coalesce((select public.is_admin()), false)
    or coalesce((select public.is_suspended()), true) then
    raise exception '只有有效的管理員帳號可以發布建議。' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) not between 1 and 500 then
    raise exception '請勾選 1 到 500 筆建議。';
  end if;

  for suggestion in
    select * from public.event_import_suggestions
    where id = any(p_ids) and published_at is null
    order by event_id
    for update
  loop
    select * into current_event from public.events where id = suggestion.event_id for update;
    if not found or to_jsonb(current_event) - 'view_count' is distinct from suggestion.base_record then
      raise exception '活動「%」已變更。整批尚未發布，請先重新核對該筆資料。', coalesce(current_event.title, suggestion.base_record->>'title');
    end if;

    if suggestion.changes = '{}'::jsonb then
      if current_event.status <> 'pending' then
        raise exception '活動「%」已審核。整批尚未發布。', current_event.title;
      end if;
      update public.events set status = 'approved', reject_reason = null where id = current_event.id;
    else
      if current_event.status <> 'approved' then
        raise exception '活動「%」已離開公開狀態。整批尚未發布。', current_event.title;
      end if;
      proposed := jsonb_populate_record(current_event, suggestion.changes);
      if proposed.end_at is not null and proposed.end_at < proposed.start_at then
        raise exception '活動「%」的結束時間早於開始。整批尚未發布。', current_event.title;
      end if;
      update public.events
      set title = proposed.title,
          description = proposed.description,
          start_at = proposed.start_at,
          end_at = proposed.end_at,
          city = proposed.city,
          district = proposed.district,
          venue = proposed.venue,
          address = proposed.address,
          age_min = proposed.age_min,
          age_max = proposed.age_max,
          fee = proposed.fee,
          fee_note = proposed.fee_note,
          link = proposed.link,
          map_link = proposed.map_link,
          audience = proposed.audience,
          flex_time = proposed.flex_time,
          dates = proposed.dates,
          continuous = proposed.continuous,
          schedule = proposed.schedule,
          shared_organizer = proposed.shared_organizer,
          series_booking = proposed.series_booking,
          recurrence_note = proposed.recurrence_note,
          age_detail = proposed.age_detail,
          age_min_month = proposed.age_min_month,
          age_max_month = proposed.age_max_month,
          booking_status = proposed.booking_status,
          booking_checked_at = proposed.booking_checked_at,
          listing_type = proposed.listing_type,
          visit_note = proposed.visit_note,
          related_exhibition_id = proposed.related_exhibition_id
      where id = current_event.id;
    end if;

    update public.event_import_suggestions
    set published_at = now(), published_by = (select auth.uid())
    where id = suggestion.id;
    published := published + 1;
  end loop;

  if published <> cardinality(p_ids) then
    raise exception '勾選的建議已變更或已發布。整批尚未發布，請重新整理後再試。';
  end if;
  return published;
end;
$$;

revoke execute on function public.publish_event_import_suggestions(uuid[]) from public, anon;
grant execute on function public.publish_event_import_suggestions(uuid[]) to authenticated;

-- The existing administrator helper resolves public.profiles from the caller's search path.
alter function public.publish_event_import_suggestions(uuid[]) set search_path to public, pg_temp;
