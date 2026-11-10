-- Pleacă la timp – confirmarea sau ștergerea semnalărilor de pe drum („Mai e” / „Nu mai e”).
-- Se rulează o singură dată în Supabase → SQL Editor. Poate fi rulat din nou fără probleme.
alter table reports add column if not exists confirmed_at timestamptz;
alter table reports add column if not exists cleared_by uuid;

create table if not exists report_votes (
  report_id text not null references reports(id) on delete cascade,
  participant uuid not null default auth.uid() references participants(id) on delete cascade,
  still boolean not null,
  at timestamptz not null default now(),
  primary key (report_id, participant)
);
alter table report_votes enable row level security;   -- nimeni nu citește direct voturile; se lucrează doar prin funcția de mai jos

-- still = true: „Mai e” → semnalarea mai rămâne activă (încă o durată obișnuită de la confirmare)
-- still = false: „Nu mai e” → semnalarea se încheie acum. Autorul o poate încheia oricând; altcineva o încheie cu un vot,
-- iar dacă altcineva a confirmat-o în ultimele 10 minute, e nevoie de două voturi „Nu mai e” de la persoane diferite.
create or replace function report_feedback(rid text, still boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  r reports; d date := (now() at time zone 'Europe/Bucharest')::date;
  m int := (extract(hour from now() at time zone 'Europe/Bucharest') * 60 + extract(minute from now() at time zone 'Europe/Bucharest'))::int;
  dur int; gone int; recent_yes int;
begin
  if auth.uid() is null then raise exception 'neautentificat'; end if;
  select * into r from reports where id = rid;
  if not found then return 'missing'; end if;
  insert into report_votes (report_id, participant, still) values (rid, auth.uid(), still)
    on conflict (report_id, participant) do update set still = excluded.still, at = now();
  dur := case r.kind when 'coada' then 60 when 'accident' then 90 when 'politie' then 45 when 'pericol' then 60 when 'banda' then 240 when 'lucrari' then 480 else 60 end;
  if still then
    update reports set confirmed_at = now(), end_date = d, end_min = least(1439, greatest(coalesce(case when end_date = d then end_min end, 0), m + dur))
      where id = rid;
    return 'confirmed';
  end if;
  select count(*) into gone from report_votes where report_id = rid and not report_votes.still;
  select count(*) into recent_yes from report_votes where report_id = rid and report_votes.still and participant <> auth.uid() and at > now() - interval '10 minutes';
  if r.participant = auth.uid() or gone >= 2 or recent_yes = 0 then
    update reports set end_date = d, end_min = greatest(r.start_min, m), cleared_by = auth.uid() where id = rid;
    return 'cleared';
  end if;
  return 'noted';
end $$;
revoke all on function report_feedback(text, boolean) from public;
grant execute on function report_feedback(text, boolean) to authenticated;

-- traficul în timp real întoarce acum și identificatorul semnalării (ca să poată fi confirmată sau ștearsă)
create or replace function live_traffic() returns jsonb
language sql stable security definer set search_path = public as $$
  with n as (
    select (now() at time zone 'Europe/Bucharest')::date as d,
           (extract(hour from now() at time zone 'Europe/Bucharest') * 60 + extract(minute from now() at time zone 'Europe/Bucharest'))::int as m
  ),
  e as (
    select o.seg_id, percentile_cont(0.5) within group (order by o.dur_min) as dur, count(*) as k
    from segment_observations o, n
    where o.obs_date = n.d and o.entry_min between n.m - 45 and n.m + 2
    group by o.seg_id
    having count(distinct o.participant) >= 2
  ),
  r as (
    select x.id, x.seg_id, x.kind, x.start_min, x.closed_lanes
    from reports x, n
    where x.start_date = n.d and x.start_min <= n.m
      and n.m < coalesce(case when x.end_date = n.d then x.end_min end,
                         x.start_min + case x.kind when 'coada' then 60 when 'accident' then 90 when 'politie' then 45
                                                   when 'pericol' then 60 when 'banda' then 240 when 'lucrari' then 480 else 60 end)
  )
  select jsonb_build_object(
    'date', (select d from n),
    'at', (select m from n),
    'edges', coalesce((select jsonb_object_agg(seg_id, jsonb_build_array(round(dur::numeric, 3), k)) from e), '{}'::jsonb),
    'notices', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'segId', seg_id, 'kind', kind, 'startMin', start_min, 'closedLanes', closed_lanes)) from r), '[]'::jsonb)
  );
$$;
revoke all on function live_traffic() from public;
grant execute on function live_traffic() to authenticated;

-- verificare: trebuie să apară „report_feedback”
select proname from pg_proc where proname in ('report_feedback', 'live_traffic') order by 1;
