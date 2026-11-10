alter table public.event_import_suggestions add column source_key text;
create index event_import_suggestions_source_key_idx
  on public.event_import_suggestions(source_key) where source_key is not null;

create function public.submit_culture_event(p_event jsonb, p_source_url text, p_source_key text)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  item public.events;
  new_id uuid;
begin
  if caller is null or not coalesce(public.is_admin(), false)
    or coalesce(public.is_suspended(), true) then
    raise exception '只有有效的管理員帳號可以匯入活動。' using errcode = '42501';
  end if;
  if p_source_key is null or char_length(p_source_key) not between 1 and 100 then
    raise exception '無法識別來源活動，請重新讀取。';
  end if;

  item := jsonb_populate_record(null::public.events, p_event);
  perform pg_advisory_xact_lock(hashtextextended('culture:' || p_source_key, 0));
  if exists (
    select 1 from public.event_import_suggestions s
    join public.events e on e.id = s.event_id
    where s.source_key = 'culture:' || p_source_key and e.status in ('pending', 'approved')
  ) or exists (
    select 1 from public.events e
    where e.link = item.link and e.title = item.title and e.start_at = item.start_at
      and e.status in ('pending', 'approved')
  ) then
    raise exception '這項活動已有投稿或已發布，請重新整理匯入清單。';
  end if;

  insert into public.events (
    author_id, status, title, description, start_at, end_at, city, district, venue,
    address, age_min, age_max, fee, fee_note, link, photo, map_link, audience,
    flex_time, dates, continuous, schedule, shared_organizer, series_booking,
    recurrence_note, age_detail, age_min_month, age_max_month, booking_status,
    booking_checked_at, listing_type, visit_note, related_exhibition_id
  ) values (
    caller, 'pending', item.title, item.description, item.start_at, item.end_at, item.city,
    item.district, item.venue, item.address, item.age_min, item.age_max, item.fee,
    item.fee_note, item.link, item.photo, item.map_link, item.audience, item.flex_time,
    item.dates, item.continuous, item.schedule, item.shared_organizer, item.series_booking,
    item.recurrence_note, item.age_detail, item.age_min_month, item.age_max_month,
    item.booking_status, item.booking_checked_at, item.listing_type, item.visit_note,
    item.related_exhibition_id
  ) returning id into new_id;

  insert into public.event_import_suggestions(event_id, source_name, source_url, source_key)
    values (new_id, '文化部開放資料', p_source_url, 'culture:' || p_source_key);
  return new_id;
end;
$$;
revoke execute on function public.submit_culture_event(jsonb, text, text) from public, anon;
grant execute on function public.submit_culture_event(jsonb, text, text) to authenticated;

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create table public.culture_feed_snapshot (
  singleton boolean primary key default true check (singleton),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  fetched_at timestamptz not null default now()
);
alter table public.culture_feed_snapshot enable row level security;
revoke all on public.culture_feed_snapshot from public, anon, authenticated;
grant select on public.culture_feed_snapshot to authenticated;
create policy "Active administrators read culture feed" on public.culture_feed_snapshot
  for select to authenticated
  using ((select public.is_admin()) and not (select public.is_suspended()));

create function public.refresh_culture_feed()
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  response extensions.http_response;
  feed jsonb;
begin
  perform set_config('http.curlopt_timeout_msec', '15000', true);
  perform set_config('http.curlopt_connecttimeout_msec', '5000', true);
  response := extensions.http_get('https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=4');
  if response.status <> 200 then
    raise exception 'Culture feed returned HTTP %', response.status;
  end if;
  feed := response.content::jsonb;
  if jsonb_typeof(feed) <> 'array' then
    raise exception 'Culture feed returned an invalid format';
  end if;
  if jsonb_array_length(feed) > 0 and not exists (
    select 1 from jsonb_array_elements(feed) item where item ? 'UID' and item ? 'startDate'
  ) then
    raise exception 'Culture feed returned no recognizable records';
  end if;

  insert into public.culture_feed_snapshot(singleton, items, fetched_at) values (true, feed, now())
    on conflict (singleton) do update set items = excluded.items, fetched_at = excluded.fetched_at;
  return jsonb_array_length(feed);
end;
$$;
revoke execute on function public.refresh_culture_feed() from public, anon, authenticated;

-- The database scheduler uses UTC. 01:00 UTC is 09:00 in Taiwan.
select cron.schedule('ideas-culture-feed-daily', '0 1 * * *', 'select public.refresh_culture_feed()');
