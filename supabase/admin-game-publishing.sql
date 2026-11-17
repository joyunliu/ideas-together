-- Active administrator organization accounts may submit their own games for review.
-- Keep ownership, moderation and suspension checks for every submission.
alter policy "games insert" on public.games to authenticated
with check (
  author_id = (select auth.uid())
  and status = 'pending'
  and not (select public.is_suspended())
  and (not (select public.is_org()) or (select public.is_admin()))
);
