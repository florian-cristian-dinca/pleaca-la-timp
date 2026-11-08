#!/usr/bin/env python3
"""
OSM -> graph.json for the mobility prediction engine (Bucharest + Ilfov pilot).

Input : an OpenStreetMap extract (.osm.pbf or .osm), e.g. Geofabrik "romania-latest.osm.pbf"
Output: graph.json  {meta, nodes, edges, places}  - same schema as the app's embedded skeleton.

Cost: 0 EUR. Runs locally or in GitHub Actions (free for public repositories).
Licence: the output is a derived database of OpenStreetMap data -> ODbL 1.0,
         attribution "(c) OpenStreetMap contributors" is mandatory.

Usage:
  python osm_import.py romania-latest.osm.pbf graph.json
  python osm_import.py region.osm graph.json --bbox 44.25,25.80,44.72,26.40 --min-class tertiary
"""
import os
import argparse, json, math, sys, datetime
from collections import defaultdict, deque

import osmium

CENTER = (44.4355, 26.1025)          # Universitate - reference for radial orientation
CITY_RADIUS_KM = 9.0                  # approx. Bucharest built-up radius (inside -> urban classes)
CIRCUITY = 1.0                        # geometry is real here, no detour factor

# class defaults - kept identical to E.CLS in the web app
CLS = {
    'A': dict(lanes=2, capLane=1900, v0=100, alpha=0.5, beta=4, base=0.60),
    'C': dict(lanes=2, capLane=1500, v0=60, alpha=0.8, beta=4, base=0.68),
    'N': dict(lanes=2, capLane=1500, v0=60, alpha=0.8, beta=4, base=0.66),
    'J': dict(lanes=1, capLane=950, v0=50, alpha=0.9, beta=4, base=0.62),
    'M': dict(lanes=3, capLane=850, v0=45, alpha=1.2, beta=4, base=0.72),
    'B': dict(lanes=2, capLane=800, v0=40, alpha=1.3, beta=4, base=0.70),
}
HIGHWAY_RANK = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']
BASE_LINE = {'motorway': 'm', 'trunk': 'm', 'primary': 'p', 'secondary': 'p', 'tertiary': 't', 'unclassified': 'r', 'residential': 'r', 'living_street': 'r', 'service': 's', 'pedestrian': 's', 'track': 'k',
             'motorway_link': 'm', 'trunk_link': 'm', 'primary_link': 'p', 'secondary_link': 'p', 'tertiary_link': 't'}
STREET_KINDS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian'}
LINK = {'motorway_link': 'motorway', 'trunk_link': 'trunk', 'primary_link': 'primary',
        'secondary_link': 'secondary', 'tertiary_link': 'tertiary'}
PLACE_TYPES = {'city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood'}
# effective free-flow speed incl. average signal / junction delay (km/h) - prior, calibrated on observed trips
EFFECTIVE_V0 = {'A': 95, 'C': 60, 'N': 60, 'J': 45, 'M': 32, 'B': 26}
# destinations that OSM maps as areas (campuses, stations, airports, malls, hospitals)
POI_TAGS = {'amenity': {'university', 'college', 'hospital'}, 'railway': {'station'}, 'aeroway': {'aerodrome'}, 'shop': {'mall'}}  # (legacy)


def poi_cat(t):
    """Destination category of an OSM object, or None. Hospitals, clinics, malls, fuel, shops, schools, stations…"""
    a, sh, hc = t.get('amenity'), t.get('shop'), t.get('healthcare')
    if a == 'hospital' or hc == 'hospital':
        return 'hospital'
    if a == 'clinic' or hc in ('clinic', 'centre'):
        return 'clinic'
    if sh == 'mall':
        return 'mall'
    if a == 'fuel':
        return 'fuel'
    if sh in ('supermarket', 'wholesale') or sh == 'doityourself':
        return 'shop'
    if a in ('university', 'college'):
        return 'university'
    if a == 'school':
        return 'school'
    if t.get('railway') == 'station' or (t.get('station') == 'subway' and t.get('public_transport') == 'station'):
        return 'station'
    if t.get('aeroway') == 'aerodrome' and (t.get('iata') or 'Aeroport' in t.get('name', '')):
        return 'airport'
    if a == 'townhall':
        return 'townhall'
    return None


def poi_name(t):
    return t.get('name') or t.get('brand') or t.get('operator')
# key pilot destinations, always added (approximate coordinates, snapped to the nearest graph node)
MANUAL_POIS = [
    ('Universitatea POLITEHNICA (Regie)', 44.4388, 26.0515),
    ('Aeroportul Henri Coandă (Otopeni)', 44.5711, 26.0850),
    ('Aeroportul Băneasa', 44.5032, 26.1021),
    ('Gara de Nord', 44.4466, 26.0751),
    ('Piața Victoriei', 44.4525, 26.0860),
    ('Piața Unirii', 44.4268, 26.1025),
    ('Piața Universității', 44.4355, 26.1025),
    ('Piața Romană', 44.4466, 26.0975),
]


def haversine(a, b):
    r = math.pi / 180
    dl, dn = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dl / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dn / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def radial_cos(a, b):
    kx = math.cos(CENTER[0] * math.pi / 180)
    dx, dy = (b[1] - a[1]) * kx, b[0] - a[0]
    cx, cy = (CENTER[1] - (a[1] + b[1]) / 2) * kx, CENTER[0] - (a[0] + b[0]) / 2
    n1, n2 = math.hypot(dx, dy), math.hypot(cx, cy)
    if n1 < 1e-9 or n2 < 1e-6:
        return 0.0
    return (dx * cx + dy * cy) / (n1 * n2)


def classify(tags, mid):
    hw = tags.get('highway')
    base = LINK.get(hw, hw)
    urban = haversine(mid, CENTER) <= CITY_RADIUS_KM
    ref, name = tags.get('ref') or '', tags.get('name') or ''
    if base == 'motorway':
        return 'A'
    if 'DNCB' in ref or 'Centura' in name:
        return 'C'
    if base == 'trunk':
        return 'M' if urban else 'N'
    if base == 'primary':
        return 'M' if urban else 'N'
    if base == 'secondary':
        return 'B' if urban else 'J'
    if base == 'tertiary':
        return 'B' if urban else 'J'
    return None


def parse_speed(v):
    if not v:
        return None
    try:
        return float(v.split()[0])
    except ValueError:
        return None


class Collector(osmium.SimpleHandler):
    def __init__(self, bbox, min_rank):
        super().__init__()
        self.bbox, self.min_rank = bbox, min_rank
        self.ways, self.places = [], []
        self.streets, self.houses = [], []   # address index (all named streets, house numbers)
        self.lx = []     # level crossings with the railway
        self.base = []   # map layer: (kind, [(lat, lon), ...]) – streets, railways, water, green areas

    def inside(self, lat, lon):
        s, w, n, e = self.bbox
        return s <= lat <= n and w <= lon <= e

    def node(self, n):
        if n.tags.get('railway') == 'level_crossing' and n.location.valid() and self.inside(n.location.lat, n.location.lon):
            self.lx.append((round(n.location.lat, 5), round(n.location.lon, 5)))
        if 'addr:housenumber' in n.tags and n.location.valid() and self.inside(n.location.lat, n.location.lon):
            st = n.tags.get('addr:street') or n.tags.get('addr:place')
            if st:
                self.houses.append((st, n.tags['addr:housenumber'], n.location.lat, n.location.lon))
        c = poi_cat(n.tags)
        if c and poi_name(n.tags) and n.location.valid() and self.inside(n.location.lat, n.location.lon):
            self.places.append(dict(name=poi_name(n.tags), kind='poi', cat=c, lat=n.location.lat, lon=n.location.lon))
        t = n.tags.get('place')
        if t in PLACE_TYPES and 'name' in n.tags and n.location.valid() and self.inside(n.location.lat, n.location.lon):
            self.places.append(dict(name=n.tags['name'], kind=t, lat=n.location.lat, lon=n.location.lon))

    def area(self, a):
        # buildings / campuses mapped as closed ways or multipolygons
        c = poi_cat(a.tags)
        hn, st = a.tags.get('addr:housenumber'), a.tags.get('addr:street') or a.tags.get('addr:place')
        t = a.tags
        ak = 'water' if (t.get('natural') == 'water' or t.get('landuse') in ('reservoir', 'basin') or t.get('waterway') == 'riverbank') else \
             'green' if (t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('forest', 'grass', 'recreation_ground', 'cemetery') or t.get('natural') == 'wood') else None
        if ak:
            try:
                for ring in a.outer_rings():
                    ll = [(nd.lat, nd.lon) for nd in ring]
                    if len(ll) >= 4 and any(self.inside(*p) for p in ll[::max(1, len(ll) // 4)]):
                        self.base.append((ak, ll))
            except Exception:
                pass
        if not (c and poi_name(a.tags)) and not (hn and st):
            return
        try:
            ring = next(iter(a.outer_rings()))
            pts = [(nd.lat, nd.lon) for nd in ring]
        except Exception:
            return
        if pts:
            la, lo = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            if self.inside(la, lo):
                if c and poi_name(a.tags):
                    self.places.append(dict(name=poi_name(a.tags), kind='poi', cat=c, lat=la, lon=lo))
                if hn and st:
                    self.houses.append((st, hn, la, lo))

    def way(self, w):
        hw = w.tags.get('highway')
        base = LINK.get(hw, hw)
        bk = BASE_LINE.get(hw) or ('rail' if w.tags.get('railway') == 'rail' and not w.tags.get('service') else None) or ('river' if w.tags.get('waterway') in ('river', 'canal') else None) \
            or ('stream' if w.tags.get('waterway') == 'stream' else None)
        if bk and not (hw == 'service' and w.tags.get('service') in ('parking_aisle', 'driveway')):
            try:
                ll = [(nd.location.lat, nd.location.lon) for nd in w.nodes]
                if ll and any(self.inside(*p) for p in ll[::max(1, len(ll) // 4)]):
                    self.base.append((bk, ll))
            except Exception:
                pass
        if hw in STREET_KINDS and w.tags.get('name'):
            try:
                ll = [(nd.location.lat, nd.location.lon) for nd in w.nodes]
                if ll and self.inside(*ll[len(ll) // 2]):
                    L = sum(haversine(ll[i - 1], ll[i]) for i in range(1, len(ll)))
                    self.streets.append((w.tags['name'], ll[len(ll) // 2][0], ll[len(ll) // 2][1], L))
            except Exception:
                pass
        if base not in HIGHWAY_RANK or HIGHWAY_RANK.index(base) > self.min_rank:
            return
        if w.tags.get('access') in ('no', 'private') or w.tags.get('area') == 'yes':
            return
        pts = []
        for nd in w.nodes:
            if not nd.location.valid():
                return
            pts.append((nd.ref, nd.location.lat, nd.location.lon))
        if len(pts) < 2 or not any(self.inside(p[1], p[2]) for p in pts):
            return
        tags = {k: w.tags.get(k) for k in ('highway', 'name', 'ref', 'oneway', 'lanes', 'lanes:forward',
                                           'lanes:backward', 'maxspeed', 'junction')}
        self.ways.append((tags, pts))


def simplify(pts, tol_km=0.012):
    """Douglas-Peucker on (lat, lon) points; returns the kept interior points (endpoints excluded)."""
    if len(pts) < 3:
        return []
    lat0 = pts[0][0]
    kx = math.cos(math.radians(lat0)) * 111.32
    xy = [((p[1] - pts[0][1]) * kx, (p[0] - lat0) * 110.57) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = xy[i]
        bx, by = xy[j]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bk = -1.0, -1
        for k in range(i + 1, j):
            px, py = xy[k]
            t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bk = d, k
        if best > tol_km:
            keep[bk] = True
            stack += [(i, bk), (bk, j)]
    return [[round(pts[k][0], 5), round(pts[k][1], 5)] for k in range(1, len(pts) - 1) if keep[k]]


TILE_LAT, TILE_LON = 0.04, 0.06


def write_tiles(base, folder):
    """Map background in tiles (~4.4 x 4.8 km): simplified lines/polygons, coordinates as 1e-5 deg integers, delta-encoded."""
    tiles = defaultdict(lambda: defaultdict(list))
    tol = {'m': 0.006, 'p': 0.006, 't': 0.006, 'r': 0.005, 's': 0.005, 'k': 0.008, 'rail': 0.008, 'river': 0.01, 'stream': 0.008, 'water': 0.01, 'green': 0.012}
    for kind, ll in base:
        if kind in ('water', 'green'):
            pts = [ll[0]] + simplify(ll, tol[kind]) + [ll[-1]]
            if len(pts) < 4:
                continue
            la = sum(p[0] for p in pts) / len(pts)
            lo = sum(p[1] for p in pts) / len(pts)
            # a polygon goes to every tile its bounding box touches
            i0, i1 = int(min(p[0] for p in pts) // TILE_LAT), int(max(p[0] for p in pts) // TILE_LAT)
            j0, j1 = int(min(p[1] for p in pts) // TILE_LON), int(max(p[1] for p in pts) // TILE_LON)
            if (i1 - i0 + 1) * (j1 - j0 + 1) > 40:
                continue
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    tiles[(i, j)][kind].append(pts)
            continue
        pts = [ll[0]] + simplify(ll, tol.get(kind, 0.006)) + [ll[-1]]
        cur, key = [pts[0]], (int(pts[0][0] // TILE_LAT), int(pts[0][1] // TILE_LON))
        for p in pts[1:]:
            cur.append(p)
            k = (int(p[0] // TILE_LAT), int(p[1] // TILE_LON))
            if k != key:   # the line crosses into another tile: close it here and start again from this point
                tiles[key][kind].append(cur)
                cur, key = [p], k
        if len(cur) >= 2:
            tiles[key][kind].append(cur)
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        os.remove(os.path.join(folder, f))
    total = 0

    def enc(pts):
        out, pl, po = [], 0, 0
        for la, lo in pts:
            a, b = round(la * 1e5), round(lo * 1e5)
            out += [a - pl, b - po]
            pl, po = a, b
        return out
    idx = []
    for (i, j), kinds in tiles.items():
        data = {k: [enc(p) for p in v] for k, v in kinds.items()}
        path = os.path.join(folder, f'{i}_{j}.json')
        with open(path, 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        total += os.path.getsize(path)
        idx.append(f'{i}_{j}')
    with open(os.path.join(folder, 'index.json'), 'w') as f:
        json.dump(dict(lat=TILE_LAT, lon=TILE_LON, tiles=sorted(idx)), f, separators=(',', ':'))
    print(f'tiles: {len(idx)} files, {total // 1024} KB')


def parse_maxspeed(v):
    """OSM maxspeed → km/h (numbers, 'RO:urban' 50, 'RO:rural' 90, 'RO:trunk' 100, 'RO:motorway' 130)."""
    if not v:
        return None
    v = v.split(';')[0].strip()
    zones = {'RO:urban': 50, 'RO:rural': 90, 'RO:trunk': 100, 'RO:motorway': 130, 'RO:living_street': 20}
    if v in zones:
        return zones[v]
    try:
        x = float(v.split()[0])
        return int(round(x * 1.609)) if 'mph' in v else int(x)
    except ValueError:
        return None


def build(ways, places):
    use = defaultdict(int)
    loc = {}
    for _, pts in ways:
        for i, (ref, lat, lon) in enumerate(pts):
            loc[ref] = (lat, lon)
            use[ref] += 2 if i in (0, len(pts) - 1) else 1
    is_vertex = {ref for ref, c in use.items() if c >= 2}

    edges = {}
    for tags, pts in ways:
        mid = (pts[len(pts) // 2][1], pts[len(pts) // 2][2])
        cls = classify(tags, mid)
        if not cls:
            continue
        ow = tags.get('oneway')
        oneway = ow in ('yes', '1', 'true') or tags.get('junction') == 'roundabout' or tags.get('highway') == 'motorway'
        reverse_only = ow == '-1'
        lanes_total = None
        try:
            lanes_total = int(float(tags['lanes'])) if tags.get('lanes') else None
        except ValueError:
            pass
        speed = parse_speed(tags.get('maxspeed'))
        # split at vertices
        seg, segs = [pts[0]], []
        for p in pts[1:]:
            seg.append(p)
            if p[0] in is_vertex:
                segs.append(seg)
                seg = [p]
        if len(seg) > 1:
            segs.append(seg)
        for s in segs:
            a, b = s[0][0], s[-1][0]
            if a == b:
                continue
            length = sum(haversine((s[i][1], s[i][2]), (s[i + 1][1], s[i + 1][2])) for i in range(len(s) - 1)) * CIRCUITY
            dirs = []
            if reverse_only:
                dirs = [(b, a)]
            elif oneway:
                dirs = [(a, b)]
            else:
                dirs = [(a, b), (b, a)]
            shape = simplify([(p[1], p[2]) for p in s])
            for (u, v) in dirs:
                c = CLS[cls]
                if oneway or reverse_only:
                    lanes = lanes_total or c['lanes']
                else:
                    key = 'lanes:forward' if (u, v) == (a, b) else 'lanes:backward'
                    try:
                        lanes = int(float(tags[key])) if tags.get(key) else (max(1, (lanes_total or 2 * c['lanes']) // 2))
                    except ValueError:
                        lanes = c['lanes']
                lanes = max(1, min(lanes, 5))
                cos = radial_cos(loc[u], loc[v])
                cin, cout = max(0, cos), max(0, -cos)
                v0 = min(speed * 0.9, EFFECTIVE_V0[cls]) if speed else EFFECTIVE_V0[cls]
                eid = f'{u}>{v}'
                if eid in edges and edges[eid]['len'] <= length:
                    continue
                ru, rv = haversine(loc[u], CENTER), haversine(loc[v], CENTER)
                edges[eid] = dict(
                    **{'from': str(u), 'to': str(v)},
                    name=tags.get('name') or tags.get('ref') or '',
                    cls=cls, lanes=lanes, capLane=c['capLane'], v0=round(v0, 1), alpha=c['alpha'], beta=c['beta'],
                    len=round(max(length, 0.01), 3),
                    am=round(min(0.95, max(0.35, c['base'] + 0.25 * cin - 0.12 * cout)), 3),
                    pm=round(min(0.95, max(0.35, c['base'] + 0.22 * cout - 0.10 * cin)), 3),
                    # heuristic: inbound entries of national roads / motorways crossing the city radius
                    bottleneck=bool(cls in ('N', 'A', 'M') and ru > CITY_RADIUS_KM >= rv),
                    radial=round(cos, 2))
                ms = parse_maxspeed(tags.get('maxspeed'))
                if ms:
                    edges[eid]['ms'] = ms
                if shape:  # intermediate shape points (simplified), in the direction of travel
                    edges[eid]['g'] = shape if (u, v) == (a, b) else shape[::-1]
    # fix edge ids as strings
    edges = {f"{e['from']}>{e['to']}": e for e in edges.values()}

    # keep the largest strongly connected component (Kosaraju, iterative)
    out, inn = defaultdict(list), defaultdict(list)
    for eid, e in edges.items():
        out[e['from']].append(e['to'])
        inn[e['to']].append(e['from'])
    verts = set(out) | set(inn)
    seen, order = set(), []
    for s in verts:
        if s in seen:
            continue
        stack = [(s, iter(out[s]))]
        seen.add(s)
        while stack:
            v, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                order.append(v)
                stack.pop()
            elif nxt not in seen:
                seen.add(nxt)
                stack.append((nxt, iter(out[nxt])))
    comp, best = {}, None
    sizes = defaultdict(int)
    for s in reversed(order):
        if s in comp:
            continue
        q = deque([s])
        comp[s] = s
        while q:
            v = q.popleft()
            sizes[s] += 1
            for w in inn[v]:
                if w not in comp:
                    comp[w] = s
                    q.append(w)
    best = max(sizes, key=sizes.get) if sizes else None
    keep = {v for v, c in comp.items() if c == best}
    edges = {k: e for k, e in edges.items() if e['from'] in keep and e['to'] in keep}

    # nodes: name = the names of the roads meeting there
    names = defaultdict(set)
    for e in edges.values():
        if e['name']:
            names[e['from']].add(e['name'])
            names[e['to']].add(e['name'])
    nodes = {}
    for v in keep:
        lat, lon = loc[int(v)]
        nm = sorted(names[v])[:2]
        nodes[str(v)] = dict(name=' × '.join(nm) if nm else 'nod ' + str(v), lat=round(lat, 6), lon=round(lon, 6),
                             zone='B' if haversine((lat, lon), CENTER) <= CITY_RADIUS_KM else 'IF')

    # places snapped to the nearest graph node (grid index)
    grid = defaultdict(list)
    for k, n in nodes.items():
        grid[(round(n['lat'] * 50), round(n['lon'] * 50))].append(k)

    def nearest(lat, lon):
        gi, gj = round(lat * 50), round(lon * 50)
        bestk, bestd = None, 1e9
        for r in range(0, 6):
            for i in range(gi - r, gi + r + 1):
                for j in range(gj - r, gj + r + 1):
                    for k in grid.get((i, j), []):
                        d = haversine((lat, lon), (nodes[k]['lat'], nodes[k]['lon']))
                        if d < bestd:
                            bestk, bestd = k, d
            if bestk:
                return bestk, bestd
        return None, None

    plist, seen = [], set()
    places = places + [dict(name=n, kind='poi', cat='landmark', lat=la, lon=lo) for n, la, lo in MANUAL_POIS]
    towns = [p for p in places if p['kind'] in ('city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood')]
    tgrid = defaultdict(list)
    for p in towns:
        tgrid[(round(p['lat'] * 20), round(p['lon'] * 20))].append(p)

    def near_town(lat, lon):
        gi, gj, best, bd = round(lat * 20), round(lon * 20), None, 1e9
        for i in range(gi - 2, gi + 3):
            for j in range(gj - 2, gj + 3):
                for p in tgrid.get((i, j), []):
                    d = haversine((lat, lon), (p['lat'], p['lon']))
                    if d < bd:
                        best, bd = p, d
        return best['name'] if best and bd < 6 else None

    for p in places:
        poi = p['kind'] == 'poi'
        key = (p['name'], round(p['lat'], 3), round(p['lon'], 3)) if poi else p['name']
        if key in seen:
            continue
        seen.add(key)
        k, d = nearest(p['lat'], p['lon'])
        if k and d < (1.5 if poi else 2.5):
            if not poi:
                nodes[k].setdefault('place', p['name'])
            q = dict(name=p['name'], kind=p['kind'], node=k, distKm=round(d, 2), lat=round(p['lat'], 5), lon=round(p['lon'], 5))
            if poi:
                q['cat'] = p.get('cat', 'landmark')
                nt = near_town(p['lat'], p['lon'])
                if nt and nt != p['name']:
                    q['near'] = nt
            plist.append(q)
    # legal speed limit where OSM has none: 50 km/h inside localities, 90 outside, 130 on motorways
    loc_pts = [(p['lat'], p['lon'], 2.0 if p['kind'] in ('city', 'town') else 0.9) for p in places if p['kind'] in ('city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood')]
    lgrid = defaultdict(list)
    for p in loc_pts:
        lgrid[(round(p[0] * 20), round(p[1] * 20))].append(p)

    def in_locality(lat, lon):
        gi, gj = round(lat * 20), round(lon * 20)
        return any(haversine((lat, lon), (p[0], p[1])) < p[2] for i in range(gi - 1, gi + 2) for j in range(gj - 1, gj + 2) for p in lgrid.get((i, j), []))
    for e in edges.values():
        e['msd'] = 1 if 'ms' not in e else 0
        if 'ms' in e:
            continue
        a, b = nodes[e['from']], nodes[e['to']]
        la, lo = (a['lat'] + b['lat']) / 2, (a['lon'] + b['lon']) / 2
        e['ms'] = 130 if e['cls'] == 'A' else 50 if (a.get('zone') == 'B' or in_locality(la, lo)) else 90
    return nodes, edges, plist, nearest, near_town


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--bbox', default='44.25,25.80,44.72,26.40', help='south,west,north,east (Bucharest + Ilfov)')
    ap.add_argument('--min-class', default='tertiary', choices=HIGHWAY_RANK)
    a = ap.parse_args()
    bbox = tuple(float(x) for x in a.bbox.split(','))
    h = Collector(bbox, HIGHWAY_RANK.index(a.min_class))
    h.apply_file(a.input, locations=True)
    nodes, edges, places, nearest, near_town = build(h.ways, h.places)
    if not edges:
        sys.exit('No edges found - check the bbox and the input file.')
    graph = dict(
        meta=dict(source='OpenStreetMap', licence='ODbL 1.0 - (c) OpenStreetMap contributors',
                  input=a.input, bbox=bbox, minClass=a.min_class,
                  built=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
                  nodes=len(nodes), edges=len(edges), places=len(places),
                  note='Demand/capacity attributes are priors from road class; calibrate on observed trips.'),
        nodes=nodes, edges=edges, places=places, hazards=dict(lx=sorted(set(h.lx))))
    with open(a.output, 'w', encoding='utf-8') as f:
        json.dump(graph, f, ensure_ascii=False, separators=(',', ':'))
    print(f"graph.json: {len(nodes)} nodes, {len(edges)} edges, {len(places)} places")
    # address index (separate file, loaded by the app only when searching): streets per locality + house numbers
    streets = {}
    for name, la, lo, L in h.streets:
        loc = near_town(la, lo) or ''
        k = (name, loc)
        if k not in streets or L > streets[k][2]:
            streets[k] = (la, lo, L)
    houses = defaultdict(list)
    for st, hn, la, lo in h.houses:
        houses[(st, near_town(la, lo) or '')].append((hn, la, lo))
    out, hs = [], {}
    for (name, loc), (la, lo, L) in sorted(streets.items()):
        k, d = nearest(la, lo)
        if not k or d > 3:
            continue
        i = len(out)
        out.append([name, loc, round(la, 5), round(lo, 5), k, round(d, 2)])
        hh = houses.get((name, loc)) or []
        if hh:
            seen = {}
            for hn, hla, hlo in hh:
                seen.setdefault(hn, (round(hla, 5), round(hlo, 5)))
            hs[i] = [[hn, p[0], p[1]] + list(nearest(p[0], p[1])[:1]) for hn, p in sorted(seen.items())]
    adr = dict(meta=dict(source='OpenStreetMap', licence='ODbL 1.0 - (c) OpenStreetMap contributors', built=graph['meta']['built']),
               streets=out, houses=hs)
    apath = os.path.join(os.path.dirname(os.path.abspath(a.output)), 'addresses.json')
    with open(apath, 'w', encoding='utf-8') as f:
        json.dump(adr, f, ensure_ascii=False, separators=(',', ':'))
    write_tiles(h.base, os.path.join(os.path.dirname(os.path.abspath(a.output)), 'tiles'))
    print(f"addresses.json: {len(out)} streets, {sum(len(v) for v in hs.values())} house numbers, {os.path.getsize(apath) // 1024} KB")


if __name__ == '__main__':
    main()
