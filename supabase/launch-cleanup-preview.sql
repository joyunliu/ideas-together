-- Read-only candidate review; no rows are changed. Use only in an admin SQL session.
-- Exclude unbounded recurring offerings. Keep all records with dependents.
with dated as (
  select e.id, e.title, e.author_id, e.photo, e.listing_type, greatest(
    coalesce(e.end_at, (date_trunc('day',e.start_at at time zone 'Asia/Taipei') + interval '1 day') at time zone 'Asia/Taipei'),
    ((select max(day) from unnest(e.dates) day)::timestamp + interval '1 day') at time zone 'Asia/Taipei',
    ((select max(slot->>'d')::date from jsonb_array_elements(
      case when jsonb_typeof(e.schedule)='array' then e.schedule else '[]'::jsonb end
    ) slot where slot->>'d' ~ '^\d{4}-\d{2}-\d{2}$')::timestamp + interval '1 day') at time zone 'Asia/Taipei'
  ) as last_possible_end
  from public.events e
  where e.status='approved' and not coalesce(e.flex_time,false)
    and e.listing_type is distinct from 'resource' and e.recurrence_note is null
), candidates as (
  select d.*,
    (select count(*) from public.event_favs f where f.event_id=d.id) as favorites,
    (select count(*) from public.event_likes l where l.event_id=d.id) as likes,
    (select count(*) from public.event_registrations r where r.event_id=d.id) as registrations,
    (select count(*) from public.reports r where r.event_id=d.id) as reports,
    (select count(*) from public.event_import_suggestions s where s.event_id=d.id) as import_records,
    (select count(*) from public.events e where e.related_exhibition_id=d.id) as linked_events,
    (select count(*) from public.content_view_events v where v.content_id=d.id and v.content_type='event') as view_records
  from dated d where d.last_possible_end < now()-interval '30 days'
)
select *, (favorites+likes+registrations+reports+import_records+linked_events+view_records>0) as has_related_data
from candidates order by last_possible_end;
