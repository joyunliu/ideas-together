-- Review and test against a staging copy before applying. No data deletes.
begin;
alter table public.events add column fee_type text, add column fee_max integer;
alter table public.events add constraint launch_event_fee_shape check (
  (fee_type is null and fee_max is null) or
  (fee_type is not null and fee is not null and (
    (fee_type in ('free','announcement') and fee = 0 and fee_max is null) or
    (fee_type = 'fixed' and fee between 1 and 100000 and fee_max is null) or
    (fee_type = 'range' and fee between 0 and 100000 and
      (fee_max is null or fee_max between fee and 100000))
  ))
);
CREATE OR REPLACE FUNCTION public.submit_verified_event_import(p_event jsonb, p_source_url text, p_culture_uid text, p_audience_evidence text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    address, age_min, age_max, fee, fee_type, fee_max, fee_note, link, photo, map_link, audience,
    flex_time, dates, continuous, schedule, shared_organizer, series_booking,
    recurrence_note, age_detail, age_min_month, age_max_month, booking_status,
    booking_checked_at, listing_type, visit_note, related_exhibition_id
  ) values (
    caller, 'pending', item.title, item.description, item.start_at, item.end_at, item.city,
    item.district, item.venue, item.address, item.age_min, item.age_max, item.fee, item.fee_type, item.fee_max,
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
$function$;

-- Central authorization: suspended administrators lose privileges at the database.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.is_admin and not coalesce(p.suspended,false)
) $$;

alter table public.reports
  add column category text check (category in ('date','place','price','booking','cancelled','other')),
  add column review_status text not null default 'open' check (review_status in ('open','resolved','dismissed')),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid;

alter policy "reports add" on public.reports with check (
  user_id = (select auth.uid()) and not (select public.is_suspended()) and
  num_nonnulls(game_id, comment_id, target_user_id, event_id) = 1 and
  char_length(btrim(reason)) between 1 and 200 and
  (category is null or (event_id is not null and exists
    (select 1 from public.events e where e.id = event_id and e.status = 'approved'))) and
  review_status = 'open' and reviewed_at is null and reviewed_by is null
);
drop policy "reports admin del" on public.reports;
create policy "reports admin resolve" on public.reports
  for update to authenticated
  using ((select public.is_admin()) and review_status = 'open')
  with check ((select public.is_admin()) and review_status in ('resolved','dismissed')
    and reviewed_by = (select auth.uid()) and reviewed_at is not null);
revoke update on public.reports from anon, authenticated;
grant update (review_status, reviewed_at, reviewed_by) on public.reports to authenticated;

create function public.launch_review_report(report_id uuid, decision text)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_admin() or decision is null or decision not in ('resolved','dismissed') then
    raise exception '無法處理這筆回報。' using errcode = '42501';
  end if;
  update public.reports set review_status = decision, reviewed_at = statement_timestamp(),
    reviewed_by = auth.uid() where id = report_id and review_status = 'open';
  if not found then raise exception '回報已處理，請重新整理。'; end if;
end
$$;
revoke all on function public.launch_review_report(uuid,text) from public, anon;
grant execute on function public.launch_review_report(uuid,text) to authenticated;

create schema if not exists launch_private;
revoke all on schema launch_private from public, anon;
grant usage on schema launch_private to authenticated;
create function launch_private.members()
returns table (id uuid, nickname text, email text, created_at timestamptz, suspended boolean, is_admin boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '沒有會員管理權限。' using errcode = '42501';
  end if;
  return query
    select p.id, p.nickname, u.email::text, u.created_at, p.suspended, p.is_admin
    from public.profiles p join auth.users u on u.id = p.id
    order by u.created_at desc, p.id limit 100;
end
$$;
revoke all on function launch_private.members() from public, anon;
grant execute on function launch_private.members() to authenticated;

create function public.launch_members()
returns table (id uuid, nickname text, email text, created_at timestamptz, suspended boolean, is_admin boolean)
language sql stable security invoker set search_path = ''
as $$ select * from launch_private.members() $$;
revoke all on function public.launch_members() from public, anon;
grant execute on function public.launch_members() to authenticated;
commit;
