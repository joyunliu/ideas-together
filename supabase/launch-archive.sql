begin;
alter table public.events add column archived_at timestamptz, add column archive_exempt boolean not null default false;
alter table public.events drop constraint events_booking_status_check;
alter table public.events add constraint events_booking_status_check check
  (booking_status in ('walkin','open','waitlist','upcoming','full','cancelled','check','postponed'));

create or replace function public.update_hosted_event_booking(p_event_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or p_status is null
    or p_status not in ('walkin', 'open', 'waitlist', 'upcoming', 'full', 'cancelled', 'check', 'postponed') then
    return false;
  end if;

  update public.events as e
  set booking_status = p_status, booking_checked_at = now()
  where e.id = p_event_id
    and e.author_id = (select auth.uid())
    and e.shared_organizer is null
    and e.status = 'approved' and e.archived_at is null
    and (p_status <> 'check' or e.link ~ '^https?://[^[:space:]]+$')
    and exists (
      select 1 from public.profiles p
      where p.id = e.author_id and p.account_type = 'organization' and p.suspended is not true
    );
  return found;
end;
$function$;

create table launch_private.archive_log (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  title text not null,
  action text not null check (action in ('archive','restore')),
  actor uuid,
  recorded_at timestamptz not null default now()
);
revoke all on launch_private.archive_log from public, anon, authenticated;

-- Users can edit their submissions, but cannot set internal archive state.
create function launch_private.guard_archive()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      if new.archived_at is not null or new.archive_exempt then
        raise exception '不能設定封存狀態。' using errcode='42501';
      end if;
    elsif (new.archived_at,new.archive_exempt) is distinct from (old.archived_at,old.archive_exempt) then
      raise exception '不能設定封存狀態。' using errcode='42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function launch_private.guard_archive() from public, anon, authenticated;
create trigger launch_guard_archive before insert or update on public.events
  for each row execute function launch_private.guard_archive();

alter policy "events read" on public.events using (
  author_id=auth.uid() or public.is_admin() or
  (status='approved' and archived_at is null and not exists
    (select 1 from public.profiles p where p.id=events.author_id and p.suspended))
);

-- Runs as the scheduled database role. Archive retains the row, media and all references.
create function launch_private.archive_expired()
returns integer language sql set search_path = '' as $$
  with moved as (
    update public.events e set archived_at=statement_timestamp()
    where e.status='approved' and e.archived_at is null and not e.archive_exempt
      and not coalesce(e.flex_time,false) and e.listing_type is distinct from 'resource'
      and e.recurrence_note is null and e.booking_status is distinct from 'postponed'
      and not exists (select 1 from jsonb_array_elements(
        case when jsonb_typeof(e.schedule)='array' then e.schedule else '[]'::jsonb end
      ) s where s->>'booking'='postponed' or not coalesce(pg_input_is_valid(s->>'d','date'),false))
      and greatest(
        coalesce(e.end_at,(date_trunc('day',e.start_at at time zone 'Asia/Taipei')+interval '1 day') at time zone 'Asia/Taipei'),
        ((select max(d) from unnest(e.dates) d)::timestamp+interval '1 day') at time zone 'Asia/Taipei',
        ((select max(case when pg_input_is_valid(s->>'d','date') then (s->>'d')::date end)
          from jsonb_array_elements(case when jsonb_typeof(e.schedule)='array' then e.schedule else '[]'::jsonb end) s
        )::timestamp+interval '1 day') at time zone 'Asia/Taipei'
      ) < statement_timestamp()-interval '30 days'
    returning e.id,e.title
  ), logged as (
    insert into launch_private.archive_log(event_id,title,action)
      select id,title,'archive' from moved returning 1
  )
  select count(*)::integer from logged;
$$;
revoke all on function launch_private.archive_expired() from public, anon, authenticated;

create function launch_private.restore_event(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '沒有還原權限。' using errcode='42501'; end if;
  with restored as (
    update public.events e set archived_at=null,archive_exempt=true
    where e.id=target and e.archived_at is not null returning e.id,e.title
  ) insert into launch_private.archive_log(event_id,title,action,actor)
      select id,title,'restore',auth.uid() from restored;
  if not found then raise exception '找不到這筆封存活動。'; end if;
end
$$;
create function launch_private.archive_history()
returns table(event_id uuid,title text,action text,recorded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.event_id,l.title,l.action,l.recorded_at from launch_private.archive_log l
    where public.is_admin() order by l.id desc limit 100;
$$;
revoke all on function launch_private.restore_event(uuid),launch_private.archive_history() from public,anon;
grant execute on function launch_private.restore_event(uuid),launch_private.archive_history() to authenticated;
create function public.launch_restore_event(target uuid)
returns void language sql set search_path = '' as $$ select launch_private.restore_event(target) $$;
create function public.launch_archive_history()
returns table(event_id uuid,title text,action text,recorded_at timestamptz)
language sql stable set search_path = '' as $$ select * from launch_private.archive_history() $$;
revoke all on function public.launch_restore_event(uuid),public.launch_archive_history() from public,anon;
grant execute on function public.launch_restore_event(uuid),public.launch_archive_history() to authenticated;
commit;
