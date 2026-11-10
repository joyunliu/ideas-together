alter table public.events
  add column recurrence_note text check (recurrence_note is null or char_length(recurrence_note) between 1 and 40),
  add column age_detail text check (age_detail is null or char_length(age_detail) between 1 and 40),
  add column age_min_month smallint,
  add column age_max_month smallint,
  add column booking_status text check (booking_status in ('walkin', 'open', 'waitlist', 'upcoming', 'full', 'cancelled')),
  add column booking_checked_at timestamptz,
  add constraint events_age_month_range check (
    (age_min_month is null and age_max_month is null)
    or (age_min_month is not null and age_max_month is not null and age_min_month between 0 and age_max_month and age_max_month <= 155)
  );

-- Preserve the exact ages from the four official New Taipei notices already reviewed.
update public.events e
set age_min_month = source.min_month, age_max_month = source.max_month
from (values
  ('親子MV流行舞蹈｜ILLIT', '2026-11-14 15:00+08'::timestamptz, 24, 83),
  ('親子共讀｜火車圖書館', '2026-11-21 13:30+08'::timestamptz, 1, 83),
  ('寶寶親子瑜珈｜4–12個月', '2026-11-21 14:00+08'::timestamptz, 4, 12),
  ('親子感統遊戲營｜翻山越嶺', '2026-11-22 11:00+08'::timestamptz, 36, 83)
) source(title, start_at, min_month, max_month)
where e.title = source.title and e.start_at = source.start_at
  and e.link like 'https://lovebaby.sw.ntpc.gov.tw/#/course-signupcourse/%'
  and e.age_min_month is null and e.age_max_month is null;

-- Update only the booking badge of the caller's own approved, hosted activity.
create function public.update_hosted_event_booking(p_event_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or p_status is null
    or p_status not in ('walkin', 'open', 'waitlist', 'upcoming', 'full', 'cancelled') then
    return false;
  end if;

  update public.events as e
  set booking_status = p_status, booking_checked_at = now()
  where e.id = p_event_id
    and e.author_id = (select auth.uid())
    and e.shared_organizer is null
    and e.status = 'approved'
    and exists (
      select 1 from public.profiles p
      where p.id = e.author_id and p.account_type = 'organization' and p.suspended is not true
    );
  return found;
end;
$function$;

revoke execute on function public.update_hosted_event_booking(uuid, text) from public, anon;
grant execute on function public.update_hosted_event_booking(uuid, text) to authenticated;
