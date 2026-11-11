-- Apply together with the matching frontend after staging verification.
begin;
create function launch_private.reaction_counts(kind text, ids uuid[])
returns table (content_id uuid, likes bigint, favs bigint, played bigint)
language sql stable security definer set search_path = ''
as $$
  select g.id,
    (select count(*) from public.likes l where l.game_id=g.id),
    (select count(*) from public.favs f where f.game_id=g.id),
    (select count(*) from public.played p where p.game_id=g.id)
  from public.games g join public.profiles p on p.id=g.author_id
  where kind='game' and cardinality(ids)<=1000 and g.id=any(ids)
    and g.status='approved' and not coalesce(p.suspended,false)
  union all
  select e.id,
    (select count(*) from public.event_likes l where l.event_id=e.id),
    (select count(*) from public.event_favs f where f.event_id=e.id), 0::bigint
  from public.events e join public.profiles p on p.id=e.author_id
  where kind='event' and cardinality(ids)<=1000 and e.id=any(ids)
    and e.status='approved' and not coalesce(p.suspended,false);
$$;
grant usage on schema launch_private to anon;
revoke all on function launch_private.reaction_counts(text,uuid[]) from public;
grant execute on function launch_private.reaction_counts(text,uuid[]) to anon,authenticated;

create function public.launch_reaction_counts(kind text, ids uuid[])
returns table (content_id uuid, likes bigint, favs bigint, played bigint)
language sql stable security invoker set search_path = ''
as $$ select * from launch_private.reaction_counts(kind,ids) $$;
revoke all on function public.launch_reaction_counts(text,uuid[]) from public;
grant execute on function public.launch_reaction_counts(text,uuid[]) to anon,authenticated;

alter policy "likes read" on public.likes to authenticated using (user_id=(select auth.uid()));
alter policy "favs read" on public.favs to authenticated using (user_id=(select auth.uid()));
alter policy "played read" on public.played to authenticated using (user_id=(select auth.uid()));
alter policy "event_likes read" on public.event_likes to authenticated using (user_id=(select auth.uid()));
alter policy "event_favs read" on public.event_favs to authenticated using (user_id=(select auth.uid()));
commit;
