-- Apply separately after approving daily soft archival. pg_cron schedules in UTC.
-- 18:15 UTC is 02:15 the next day in Taiwan.
select cron.schedule('ideas-archive-expired','15 18 * * *','select launch_private.archive_expired()');
-- To stop future runs: select cron.unschedule('ideas-archive-expired');
