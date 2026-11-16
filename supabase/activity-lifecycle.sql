-- Run transactionally after inspecting the production events schema.
begin;
alter table public.events drop constraint events_status_check;
alter table public.events add constraint events_status_check check(status in ('pending','approved','rejected','draft','archived'));
-- A NULL boundary means dates need confirmation; never infer expiry from creation date.
create or replace function public.event_effective_end(e public.events)
returns timestamptz language plpgsql stable set search_path='' as $$
declare boundary timestamptz; slot jsonb; candidate timestamptz; day date;
begin
 if e.listing_type='resource' or e.booking_status='postponed' then return null; end if;
 if jsonb_typeof(e.schedule)='array' and jsonb_array_length(e.schedule)>0 then
  for slot in select value from jsonb_array_elements(e.schedule) loop
   if slot->>'booking'='cancelled' then continue; end if;
   if slot->>'booking'='postponed' or not coalesce(pg_input_is_valid(slot->>'d','date'),false) then return null; end if;
   if coalesce(slot->>'e','')<>'' and not pg_input_is_valid(slot->>'e','time') then return null; end if;
   candidate:=((slot->>'d')::date+coalesce(nullif(slot->>'e','')::time,time '23:59:59')) at time zone 'Asia/Taipei';
   boundary:=greatest(boundary,candidate);
  end loop;
  return boundary;
 end if;
 if e.recurrence_note is not null and e.end_at is null then return null; end if;
 if e.end_at is not null then boundary:=e.end_at;
 elsif e.start_at is not null and not coalesce(e.flex_time,false) then
  boundary:=((e.start_at at time zone 'Asia/Taipei')::date+time '23:59:59') at time zone 'Asia/Taipei';
 end if;
 if cardinality(e.dates)>0 then
  select max(d) into day from unnest(e.dates) d;
  if boundary is null or day>(boundary at time zone 'Asia/Taipei')::date then
   boundary:=(day+time '23:59:59') at time zone 'Asia/Taipei';
  end if;
 end if;
 return boundary;
end $$;
create or replace function launch_private.archive_expired()
returns integer language sql set search_path='' as $$
 with moved as (
 update public.events e set status='archived',archived_at=statement_timestamp()
 where e.status='approved' and e.archived_at is null
 and public.event_effective_end(e)<statement_timestamp()
 returning e.id,e.title
 ), logged as (
 insert into launch_private.archive_log(event_id,title,action) select id,title,'archive' from moved returning 1
 ) select count(*)::integer from logged
$$;
create or replace function launch_private.restore_event(target uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '沒有還原權限。' using errcode='42501'; end if;
 with restored as (
 update public.events set status='draft',archived_at=null,archive_exempt=false
 where id=target and archived_at is not null returning id,title
 ) insert into launch_private.archive_log(event_id,title,action,actor) select id,title,'restore',auth.uid() from restored;
 if not found then raise exception '找不到這筆封存活動。'; end if;
end $$;
-- Restores intentionally return to draft: expired content must be corrected before publishing.
update public.events set status='archived' where archived_at is not null;
select cron.schedule('ideas-archive-expired','5 16 * * *','select launch_private.archive_expired()');
-- 00:05 Asia/Taipei, cron server remains UTC. No scheduled permanent deletion.
-- Private privileged implementation with an explicit live admin check.
create or replace function launch_private.admin_activity_action(targets uuid[], action text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() or public.is_suspended() then raise exception '沒有管理權限' using errcode='42501'; end if;
 if cardinality(targets)>500 then raise exception '每批最多 500 筆'; end if;
 if action='archived' then
  with moved as (update public.events set status='archived',archived_at=now() where id=any(targets) and archived_at is null returning id,title)
  insert into launch_private.archive_log(event_id,title,action,actor) select id,title,'archive',auth.uid() from moved;
 elsif action='approved' then
  if exists(select 1 from public.events e where id=any(targets) and (archived_at is not null or public.event_effective_end(e)<now())) then raise exception '已結束或封存活動不可直接發布'; end if;
  update public.events set status='approved',reject_reason=null where id=any(targets);
 elsif action='delete' then
  delete from public.events where id=any(targets);
 else raise exception '不支援的操作'; end if;
end $$;
revoke all on function launch_private.admin_activity_action(uuid[],text) from public,anon;
grant execute on function launch_private.admin_activity_action(uuid[],text) to authenticated;
create or replace function public.admin_activity_action(targets uuid[],action text)
returns void language sql set search_path='' as $$ select launch_private.admin_activity_action(targets,action) $$;
revoke all on function public.admin_activity_action(uuid[],text) from public,anon;
grant execute on function public.admin_activity_action(uuid[],text) to authenticated;
commit;
