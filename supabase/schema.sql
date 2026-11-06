-- Pleacă la timp – Supabase schema (safe to run again: every statement is idempotent) (Postgres, EU region recommended: Frankfurt)
-- Participants sign in anonymously (Supabase anonymous sign-ins); every row is owned by auth.uid().
-- The scheduled forecast job uses the service-role key (GitHub secret) and bypasses RLS.

create table if not exists participants (
  id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  pid text unique not null,                        -- pseudonymous code shown to the participant
  consent_version text not null,
  consent_at timestamptz not null default now(),
  lead_min int not null default 30 check (lead_min between 5 and 120),
  evening_alert boolean not null default true,
  evening_at time not null default '21:00',
  created_at timestamptz not null default now()
);

create table if not exists habits (
  id bigint generated always as identity primary key,
  participant uuid not null default auth.uid() references participants(id) on delete cascade,
  name text not null,
  origin_node text not null,                       -- graph node id (locality / neighbourhood level, no addresses)
  dest_node text not null,
  arrive_by time not null,
  usual_departure time not null,
  days smallint[] not null default '{1,2,3,4,5}', -- 0 = Sunday … 6 = Saturday
  created_at timestamptz not null default now()
);

create table if not exists trips (
  id text primary key,
  participant uuid not null default auth.uid() references participants(id) on delete cascade,
  trip_date date not null,
  dep_min smallint not null check (dep_min between 0 and 1439),
  dur_min real not null check (dur_min > 0 and dur_min < 300),
  origin_node text not null,
  dest_node text not null,
  path text[] not null,                            -- edge ids of the model route
  weather text not null default 'senin',
  pred jsonb,                                      -- prediction archived BEFORE departure (prospective validation)
  on_time boolean,
  source text not null default 'participant',
  created_at timestamptz not null default now()
);

create table if not exists segment_observations (
  id bigint generated always as identity primary key,
  participant uuid not null default auth.uid() references participants(id) on delete cascade,
  seg_id text not null,
  obs_date date not null,
  entry_min real not null,
  dur_min real not null check (dur_min > 0),
  weather text not null default 'senin',
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id text primary key,
  participant uuid not null default auth.uid() references participants(id) on delete cascade,
  kind text not null check (kind in ('coada','accident','banda','lucrari')),
  seg_id text not null,
  closed_lanes smallint not null default 0,
  start_date date not null, start_min smallint not null,
  end_date date, end_min smallint,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  endpoint text primary key,
  participant uuid not null default auth.uid() references participants(id) on delete cascade,
  keys jsonb not null,                             -- {p256dh, auth}
  created_at timestamptz not null default now()
);

-- written only by the scheduled job (service role); readable by every signed-in participant
create table if not exists model_packs (
  version text primary key,
  created_at timestamptz not null default now(),
  pack jsonb not null                              -- {lr, conf, tau, restrictions, edgeEdits, weather}
);

-- notifications already sent (prevents duplicates when the job runs every 30 min)
create table if not exists sent_alerts (
  participant uuid not null references participants(id) on delete cascade,
  alert_key text not null,
  sent_at timestamptz not null default now(),
  primary key (participant, alert_key)
);

-- Row Level Security
alter table participants enable row level security;
alter table habits enable row level security;
alter table trips enable row level security;
alter table segment_observations enable row level security;
alter table reports enable row level security;
alter table push_subscriptions enable row level security;
alter table model_packs enable row level security;
alter table sent_alerts enable row level security;

drop policy if exists own_participant on participants;
create policy own_participant on participants for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists own_habits on habits;
create policy own_habits on habits for all using (participant = auth.uid()) with check (participant = auth.uid());
drop policy if exists own_trips on trips;
create policy own_trips on trips for all using (participant = auth.uid()) with check (participant = auth.uid());
drop policy if exists own_segobs on segment_observations;
create policy own_segobs on segment_observations for all using (participant = auth.uid()) with check (participant = auth.uid());
drop policy if exists own_reports on reports;
create policy own_reports on reports for all using (participant = auth.uid()) with check (participant = auth.uid());
drop policy if exists own_push on push_subscriptions;
create policy own_push on push_subscriptions for all using (participant = auth.uid()) with check (participant = auth.uid());
drop policy if exists read_packs on model_packs;
create policy read_packs on model_packs for select using (auth.role() = 'authenticated');

-- right to erasure: deleting the auth user cascades to every table above
create or replace function delete_my_data() returns void language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
grant execute on function delete_my_data() to authenticated;

create index if not exists trips_date_idx on trips (trip_date);
create index if not exists reports_date_idx on reports (start_date);

-- Explicit privileges (the project is created with "Automatically expose new tables" OFF).
-- Anonymous sign-ins get the `authenticated` role; RLS policies above restrict every row to its owner.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on participants, habits, trips, segment_observations, reports, push_subscriptions to authenticated;
grant select on model_packs to authenticated;
-- sent_alerts: no client access (service role only)
-- The scheduled job uses the service role: it bypasses RLS but still needs table privileges
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role, authenticated;
