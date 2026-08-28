-- Corrective migration: the application uses request-driven heartbeats and
-- must not own a Supabase Cron job for Waiting Room cleanup.
do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    for v_job_id in
      select jobid
      from cron.job
      where jobname = 'expire-stale-waiting-room-members'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
  end if;
end
$$;