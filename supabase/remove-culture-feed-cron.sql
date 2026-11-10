-- Candidate snapshots are refreshed by GitHub Actions.
select cron.unschedule('ideas-culture-feed-daily');
drop function public.refresh_culture_feed();
drop table public.culture_feed_snapshot;
