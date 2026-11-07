-- Pleacă la timp – grupul „Familie” (se poate rula de mai multe ori; nu modifică datele existente)
-- Poziția se partajează doar în timpul unui drum pornit cu „Am plecat”; serverul păstrează numai ULTIMA poziție.
-- Copiii sub 16 ani intră în grup doar cu acordul unui părinte / tutore, dat în aplicație de un adult din grup.

create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                          -- cod de invitație (8 caractere)
  created_by uuid not null default auth.uid() references participants(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists family_members (
  family uuid not null references families(id) on delete cascade,
  participant uuid not null references participants(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  minor boolean not null default false,               -- sub 16 ani
  approved boolean not null default true,             -- pentru minori: acordul părintelui
  guardian uuid references participants(id) on delete set null,
  guardian_consent_at timestamptz,
  sharing boolean not null default true,              -- „Opresc partajarea” = false
  joined_at timestamptz not null default now(),
  primary key (family, participant)
);
create unique index if not exists family_members_one_group on family_members (participant);   -- un singur grup / persoană

create table if not exists live_positions (
  participant uuid primary key default auth.uid() references participants(id) on delete cascade,
  lat double precision not null, lon double precision not null,
  acc real, speed_kmh real,
  dest_name text, eta_min real, ta_min real, status text not null default 'pe drum' check (status in ('pe drum', 'a ajuns')),
  day date not null default current_date,
  updated_at timestamptz not null default now()
);

alter table families enable row level security;
alter table family_members enable row level security;
alter table live_positions enable row level security;

-- grupul meu (fără recursivitate în politici)
create or replace function my_family() returns uuid language sql stable security definer set search_path = public as $$
  select family from family_members where participant = auth.uid()
$$;
-- pot vedea poziția acestei persoane? (același grup, amândoi aprobați, ea partajează)
create or replace function can_see(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select p = auth.uid() or exists (
    select 1 from family_members a join family_members b on a.family = b.family
    where a.participant = auth.uid() and b.participant = p and a.approved and b.approved and b.sharing)
$$;

drop policy if exists fam_select on families;
create policy fam_select on families for select using (id = my_family());
drop policy if exists fam_delete on families;
create policy fam_delete on families for delete using (created_by = auth.uid());

drop policy if exists mem_select on family_members;
create policy mem_select on family_members for select using (family = my_family());
drop policy if exists mem_update_self on family_members;
create policy mem_update_self on family_members for update using (participant = auth.uid()) with check (participant = auth.uid());
drop policy if exists mem_delete on family_members;
create policy mem_delete on family_members for delete using (participant = auth.uid() or family in (select id from families where created_by = auth.uid()));

drop policy if exists pos_own on live_positions;
create policy pos_own on live_positions for all using (participant = auth.uid()) with check (participant = auth.uid());
drop policy if exists pos_family on live_positions;
create policy pos_family on live_positions for select using (can_see(participant));

-- creez grupul (devin primul membru, adult)
create or replace function create_family(p_name text) returns text language plpgsql security definer set search_path = public as $$
declare c text; f uuid;
begin
  if exists (select 1 from family_members where participant = auth.uid()) then raise exception 'already_in_family'; end if;
  loop
    c := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', ''), 1, 8));
    exit when length(c) = 8 and not exists (select 1 from families where code = c);
  end loop;
  insert into families (code, created_by) values (c, auth.uid()) returning id into f;
  insert into family_members (family, participant, display_name) values (f, auth.uid(), left(p_name, 30));
  return c;
end $$;

-- intru în grup cu codul; minorii rămân „în așteptare” până la acordul părintelui
create or replace function join_family(p_code text, p_name text, p_minor boolean) returns uuid language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  select id into f from families where code = upper(trim(p_code));
  if f is null then raise exception 'bad_code'; end if;
  if exists (select 1 from family_members where participant = auth.uid()) then raise exception 'already_in_family'; end if;
  insert into family_members (family, participant, display_name, minor, approved) values (f, auth.uid(), left(p_name, 30), p_minor, not p_minor);
  return f;
end $$;

-- acordul părintelui / tutorelui pentru un copil din grup (doar un adult aprobat din același grup)
create or replace function approve_minor(p_participant uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from family_members where participant = auth.uid() and family = my_family() and approved and not minor) then raise exception 'not_allowed'; end if;
  update family_members set approved = true, guardian = auth.uid(), guardian_consent_at = now()
   where participant = p_participant and family = my_family() and minor;
end $$;

grant execute on function my_family(), can_see(uuid), create_family(text), join_family(text, text, boolean), approve_minor(uuid) to authenticated;
-- grupurile și membrii se creează doar prin funcțiile de mai sus; un membru își poate schimba doar numele și partajarea
grant select, delete on families, family_members to authenticated;
revoke insert, update on families, family_members from authenticated;
grant update (display_name, sharing) on family_members to authenticated;
grant select, insert, update, delete on live_positions to authenticated;
grant all on families, family_members, live_positions to service_role;
