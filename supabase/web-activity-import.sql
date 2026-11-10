create table public.web_activity_candidates (
  source_url text primary key check (
    source_url ~ '^https?://[a-zA-Z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$'
    and char_length(source_url) <= 1000
  ),
  title text not null check (char_length(title) between 1 and 140),
  organizer text check (char_length(organizer) <= 100),
  city text check (char_length(city) <= 20),
  venue text check (char_length(venue) <= 60),
  first_day date not null,
  last_day date not null check (last_day >= first_day),
  audience_evidence text not null check (
    char_length(audience_evidence) between 2 and 160
    and audience_evidence ~ '親子|家長|孩子|小孩|孩童|兒童|兒少|學童|幼兒|嬰幼兒|小朋友|青少年|國小|幼兒園|寶寶'
  ),
  review_note text check (char_length(review_note) <= 240),
  found_at timestamptz not null default now()
);

alter table public.web_activity_candidates enable row level security;
revoke all on public.web_activity_candidates from public, anon, authenticated;
grant select on public.web_activity_candidates to authenticated;
create policy "Active administrators read web candidates" on public.web_activity_candidates
  for select to authenticated
  using ((select public.is_admin()) and not (select public.is_suspended()));

alter table public.event_import_suggestions add column audience_evidence text;

create function public.list_web_activity_candidates()
returns setof public.web_activity_candidates
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.*
  from public.web_activity_candidates c
  where c.last_day >= (now() at time zone 'Asia/Taipei')::date
    and not exists (
      select 1 from public.event_import_suggestions s join public.events e on e.id = s.event_id
      where s.source_url = c.source_url and e.status in ('pending', 'approved')
    )
    and not exists (
      select 1 from public.events e where e.link = c.source_url and e.status in ('pending', 'approved')
    )
  order by c.first_day, c.found_at desc
  limit 80;
$$;
revoke execute on function public.list_web_activity_candidates() from public, anon;
grant execute on function public.list_web_activity_candidates() to authenticated;

create function public.submit_verified_event_import(p_event jsonb, p_source_url text, p_culture_uid text, p_audience_evidence text)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  item public.events;
  new_id uuid;
  candidate_key text;
  candidate_source text;
  evidence text := btrim(p_audience_evidence);
begin
  if caller is null or not coalesce(public.is_admin(), false)
    or coalesce(public.is_suspended(), true) then
    raise exception '只有有效的管理員帳號可以匯入活動。' using errcode = '42501';
  end if;
  if p_source_url is null or char_length(p_source_url) > 1000
    or p_source_url !~ '^https?://[a-zA-Z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$' then
    raise exception '請提供有效的主辦方公告或報名連結。';
  end if;
  if evidence is null or char_length(evidence) not between 2 and 160
    or evidence !~ '親子|家長|孩子|小孩|孩童|兒童|兒少|學童|幼兒|嬰幼兒|小朋友|青少年|國小|幼兒園|寶寶' then
    raise exception '請填寫來源明確標示的親子、家長或兒童對象文字。';
  end if;
  if p_culture_uid is not null and char_length(p_culture_uid) not between 1 and 100 then
    raise exception '無法識別來源活動，請重新讀取。';
  end if;
  candidate_key := case when p_culture_uid is null then 'web:' || md5(p_source_url) else 'culture:' || p_culture_uid end;
  candidate_source := case when p_culture_uid is null then left(substring(p_source_url from '^https?://([^/?#]+)'), 100)
    else '文化部開放資料' end;

item := jsonb_populate_record(null::public.events, p_event);
  perform pg_advisory_xact_lock(hashtextextended(p_source_url, 0));
  if exists (
    select 1 from public.event_import_suggestions s
    join public.events e on e.id = s.event_id
    where (s.source_key = candidate_key or (p_culture_uid is null and s.source_url = p_source_url)) and e.status in ('pending', 'approved')
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

  insert into public.event_import_suggestions(event_id, source_name, source_url, source_key, audience_evidence)
    values (new_id, candidate_source, p_source_url, candidate_key, evidence);
  return new_id;
end;
$$;
revoke execute on function public.submit_verified_event_import(jsonb, text, text, text) from public, anon;
grant execute on function public.submit_verified_event_import(jsonb, text, text, text) to authenticated;
