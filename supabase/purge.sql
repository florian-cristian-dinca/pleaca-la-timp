-- Pleacă la timp – ștergerea pozițiilor familiei mai vechi de 10 minute, direct în baza de date (la fiecare 5 minute).
-- Programatorul GitHub pornește verificările doar o dată la câteva ore, așa că ștergerea nu mai depinde de el.
-- Se rulează o singură dată în Supabase → SQL Editor. Poate fi rulat din nou fără probleme.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

select cron.schedule(
  'plt-sterge-pozitii-vechi',          -- dacă există deja o sarcină cu acest nume, este înlocuită
  '*/5 * * * *',
  $$delete from public.live_positions where updated_at < now() - interval '10 minutes'$$
);

-- verificare: trebuie să apară o linie cu numele de mai sus
select jobname, schedule, active from cron.job where jobname = 'plt-sterge-pozitii-vechi';
