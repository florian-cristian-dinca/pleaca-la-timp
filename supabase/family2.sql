-- Pleacă la timp – informații în plus pentru grupul de familie: distanța rămasă, distanța parcursă și costul drumului.
-- Se rulează o singură dată în Supabase → SQL Editor. Poate fi rulat din nou fără probleme.
alter table live_positions add column if not exists rem_km real;           -- km rămași până la destinație
alter table live_positions add column if not exists driven_km real;        -- km parcurși de la plecare
alter table live_positions add column if not exists cost_lei real;         -- costul combustibilului / energiei până acum
alter table live_positions add column if not exists cost_total_lei real;   -- costul estimat pentru tot drumul

-- verificare: trebuie să apară cele 4 coloane
select column_name from information_schema.columns where table_name = 'live_positions' and column_name in ('rem_km', 'driven_km', 'cost_lei', 'cost_total_lei') order by 1;
