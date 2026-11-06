# OSM importer – mobility prediction engine (Bucharest + Ilfov)

Builds `graph.json` (nodes, directed edges, places) from OpenStreetMap for the web app.

```
pip install osmium
python osm_import.py romania-latest.osm.pbf graph.json --bbox 44.25,25.80,44.72,26.40 --min-class tertiary
```

* Input: Geofabrik extract `https://download.geofabrik.de/europe/romania-latest.osm.pbf` (free).
* Kept roads: motorway, trunk, primary, secondary, tertiary (+ links); largest strongly connected component only.
* Edge attributes (lanes, capacity per lane, free speed, BPR α/β, AM/PM demand ratios, bottleneck flag) are
  **priors** derived from the road class and radial orientation – the same rules as `E.edgeAttrs` in the app.
  They must be calibrated on observed trips.
* `places`: OSM `place=*` nodes (towns, villages, suburbs, quarters) snapped to the nearest graph node; the app uses
  them as origin/destination choices.
* Licence: the output is an ODbL 1.0 derived database – keep the attribution "© OpenStreetMap contributors".
* Automation: `.github/workflows/build-graph.yml` rebuilds the graph monthly on GitHub Actions (0 EUR for public repos).
  Place `graph.json` next to `index.html` on GitHub Pages; the app loads it automatically when present.
