-- Pleacă la timp – traficul măsurat de participanți și semnalările active, calculate de baza de date în momentul cererii.
-- Aplicația îl cere la 1–3 minute; nu mai depinde de programatorul GitHub (care pornește doar o dată la câteva ore).
-- Confidențialitate: pentru un tronson se dă doar timpul median din ultimele 45 de minute și numărul de măsurători,
-- numai dacă cel puțin 2 participanți diferiți l-au parcurs (drumul unei singure persoane nu poate fi citit de aici).
-- Se rulează o singură dată în Supabase → SQL Editor. Poate fi rulat din nou fără probleme.
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
    select x.seg_id, x.kind, x.start_min, x.closed_lanes
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
    'notices', coalesce((select jsonb_agg(jsonb_build_object('segId', seg_id, 'kind', kind, 'startMin', start_min, 'closedLanes', closed_lanes)) from r), '[]'::jsonb)
  );
$$;
revoke all on function live_traffic() from public;
grant execute on function live_traffic() to authenticated;

-- verificare: trebuie să apară un rând cu data și ora de acum
select live_traffic();
