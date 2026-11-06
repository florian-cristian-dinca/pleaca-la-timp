# Pleacă la timp

Traffic-jam early warning for commuters in Bucharest + Ilfov (research pilot, PRO SMART WORK S.R.L.).
The app does **not** show a route: it warns ahead of time (the evening before and before departure) when a jam
is expected on the user's usual trip and recommends the departure time that minimises time stuck in traffic
while arriving on time.

## Structure

| Path | Content |
| --- | --- |
| `index.html` | participant app (installable PWA) |
| `engine.js` | prediction engine (graph model, BPR + point queue, Monte Carlo, edge learning, Mondrian conformal calibration) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: offline cache, install, web push |
| `expert/` | coordinator / expert app (analyses, validation, URRD) |
| `osm/osm_import.py` | OpenStreetMap → `graph.json` importer |
| `.github/workflows/build-graph.yml` | monthly graph rebuild (free on GitHub Actions) |
| `supabase/schema.sql` | database schema with row-level security (week 2) |

## Publishing (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → `main` / root. The app is then served at
`https://florian-cristian-dinca.github.io/pleaca-la-timp/`.

Run *Actions → build-graph → Run workflow* once to create `graph.json` from OpenStreetMap; the app loads it
automatically (otherwise it falls back to the built-in schematic network).

## Cost

0 EUR: GitHub Pages, GitHub Actions (public repo), OpenStreetMap data, Supabase free plan.
No commercial traffic API is called.

## Licences

Map data © OpenStreetMap contributors, ODbL 1.0 (`graph.json` is a derived database).
