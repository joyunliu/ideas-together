alter table public.web_activity_candidates
  alter column organizer set not null,
  add constraint web_activity_candidates_organizer_nonempty check (btrim(organizer) <> ''),
  add column details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object');

create function public.validate_new_import_suggestion()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item public.events;
begin
  if new.changes <> '{}'::jsonb then return new; end if;

  -- The snapshot trigger runs first and captures the current event in this transaction.
  item := jsonb_populate_record(null::public.events, new.base_record);
  if nullif(btrim(item.shared_organizer), '') is null then
    raise exception '請填寫主辦方名稱。';
  end if;
  if nullif(btrim(item.title), '') is null or nullif(btrim(item.description), '') is null then
    raise exception '請填寫活動名稱與說明。';
  end if;
  if item.city <> '線上活動' and (nullif(btrim(item.venue), '') is null or nullif(btrim(item.district), '') is null) then
    raise exception '請填寫活動所在行政區和場地。';
  end if;
  if item.start_at is null or (not item.flex_time and (
    item.end_at is null or item.end_at <= item.start_at or exists (
      select 1 from jsonb_array_elements(coalesce(item.schedule, '[]'::jsonb)) slot
      where nullif(slot->>'e', '') is null
    )
  )) then
    raise exception '請填寫每場活動的日期、開始和結束時間。';
  end if;
  if item.booking_status is null and (
    coalesce(jsonb_array_length(item.schedule), 0) = 0 or exists (
      select 1 from jsonb_array_elements(item.schedule) slot where nullif(slot->>'booking', '') is null
    )
  ) then
    raise exception '請填寫整則活動的報名狀態，或逐場標示報名狀態。';
  end if;
  if item.audience <> 'parents' and item.age_min = 0 and item.age_max = 12
    and item.age_min_month is null and nullif(btrim(item.age_detail), '') is null then
    raise exception '請填寫來源公告的適合年齡、月齡或年級。';
  end if;
  if item.link is null or item.link !~ '^https?://[^[:space:]]+$' then
    raise exception '請提供主辦方的官方公告或報名連結。';
  end if;
  if new.audience_evidence is null or char_length(btrim(new.audience_evidence)) not between 2 and 160
    or new.audience_evidence !~ '親子|家長|孩子|小孩|孩童|兒童|兒少|學童|幼兒|小朋友|青少年|國小|寶寶' then
    raise exception '請填寫來源明確標示的親子、家長或兒童對象文字。';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_new_import_suggestion() from public, anon, authenticated;

create trigger event_import_verify_new
  before insert on public.event_import_suggestions
  for each row execute function public.validate_new_import_suggestion();
