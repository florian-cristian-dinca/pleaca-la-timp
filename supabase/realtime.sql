-- Pleacă la timp – actualizare în timp real (la secundă) pentru pozițiile și mesajele familiei.
-- Regulile de acces (RLS) rămân valabile: fiecare primește doar ce are voie să vadă.
-- Se rulează o singură dată în Supabase → SQL Editor. Poate fi rulat din nou fără probleme.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'live_positions') then
    alter publication supabase_realtime add table public.live_positions;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'family_messages')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'family_messages') then
    alter publication supabase_realtime add table public.family_messages;
  end if;
end $$;

-- verificare: trebuie să apară cele două tabele
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('live_positions', 'family_messages') order by 1;
