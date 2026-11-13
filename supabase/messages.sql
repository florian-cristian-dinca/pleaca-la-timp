-- Pleacă la timp – mesaje în grupul de familie.
-- Doar membrii aprobați ai aceluiași grup pot scrie și citi; mesajele se șterg automat după 7 zile.
-- Se rulează o singură dată în Supabase → SQL Editor. Poate fi rulat din nou fără probleme.
create table if not exists family_messages (
  id bigint generated always as identity primary key,
  family uuid not null references families(id) on delete cascade,
  sender uuid not null default auth.uid() references participants(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  quick boolean not null default false,               -- mesaj rapid (butoanele „Am plecat”, „Întârzii 10 min”…)
  created_at timestamptz not null default now()
);
create index if not exists family_messages_fam_time on family_messages (family, created_at desc);
alter table family_messages enable row level security;

-- sunt membru aprobat al acestui grup?
create or replace function is_member(f uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from family_members where family = f and participant = auth.uid() and approved)
$$;

drop policy if exists msg_select on family_messages;
create policy msg_select on family_messages for select using (is_member(family) and created_at > now() - interval '7 days');
drop policy if exists msg_insert on family_messages;
create policy msg_insert on family_messages for insert with check (sender = auth.uid() and is_member(family));
drop policy if exists msg_delete on family_messages;
create policy msg_delete on family_messages for delete using (sender = auth.uid());   -- fiecare își poate șterge mesajele

revoke all on family_messages from anon;
grant select, insert, delete on family_messages to authenticated;

-- ștergerea automată a mesajelor mai vechi de 7 zile (o dată pe oră)
select cron.schedule('plt-sterge-mesaje-vechi', '17 * * * *', $$delete from public.family_messages where created_at < now() - interval '7 days'$$);

-- verificare: trebuie să apară tabelul și sarcina de ștergere
select (select count(*) from information_schema.tables where table_name = 'family_messages') as tabel,
       (select count(*) from cron.job where jobname = 'plt-sterge-mesaje-vechi') as stergere_automata;
