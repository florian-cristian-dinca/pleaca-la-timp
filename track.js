/* Pleacă la timp – GPS map-matching on the road graph (browser + node tests).
   Matches each GPS fix to a directed road segment of the whole graph (not only the planned route), keeps the
   sequence of segments actually driven and the time spent on each one. Only these segment times leave the phone. */
(function (root) {
  function createTracker(E, NET) {
    const KX = lat => Math.cos(lat * Math.PI / 180) * 111.32, KY = 110.57;
    const GEO = new Map();
    // polyline of an edge, in the direction of travel: [{lat, lon}, …], endpoints included
    function geom(eid) {
      let g = GEO.get(eid); if (g) return g;
      const e = NET.edges[eid], a = NET.nodes[e.from], b = NET.nodes[e.to];
      let mid = e.g;
      if (!mid) { const r = NET.edges[e.to + '>' + e.from]; if (r && r.g) mid = r.g.slice().reverse(); }
      g = [{ lat: a.lat, lon: a.lon }].concat((mid || []).map(p => ({ lat: p[0], lon: p[1] })), [{ lat: b.lat, lon: b.lon }]);
      let L = 0; g.cum = [0]; for (let i = 1; i < g.length; i++) { L += E.haversine(g[i - 1], g[i]); g.cum.push(L); } g.geoLen = L || 1e-6;
      GEO.set(eid, g); return g;
    }
    // spatial grid (≈ 550 m × 400 m cells)
    const CELL = 0.005; let GRID = null;
    const key = (i, j) => i + ':' + j;
    function grid() {
      if (GRID) return GRID; GRID = new Map();
      for (const eid in NET.edges) {
        const g = geom(eid); let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
        for (const p of g) { la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat); lo0 = Math.min(lo0, p.lon); lo1 = Math.max(lo1, p.lon); }
        for (let i = Math.floor(la0 / CELL); i <= Math.floor(la1 / CELL); i++) for (let j = Math.floor(lo0 / CELL); j <= Math.floor(lo1 / CELL); j++) {
          const k = key(i, j); let c = GRID.get(k); if (!c) GRID.set(k, c = []); c.push(eid);
        }
      }
      return GRID;
    }
    function inBox(la0, la1, lo0, lo1) { // edges whose cells overlap a box
      const G = grid(), out = new Set();
      for (let i = Math.floor(la0 / CELL); i <= Math.floor(la1 / CELL); i++) for (let j = Math.floor(lo0 / CELL); j <= Math.floor(lo1 / CELL); j++) { const c = G.get(key(i, j)); if (c) for (const e of c) out.add(e); }
      return out;
    }
    function near(lat, lon) {
      const G = grid(), i0 = Math.floor(lat / CELL), j0 = Math.floor(lon / CELL), out = new Set();
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const c = G.get(key(i, j)); if (c) for (const e of c) out.add(e); }
      return out;
    }
    // projection of a point on an edge: d = distance (km), s = position along the edge (km, in the edge's own length), brg = bearing there (rad)
    function projEdge(eid, lat, lon) {
      const g = geom(eid), kx = KX(lat), e = NET.edges[eid]; let best = null;
      for (let i = 0; i < g.length - 1; i++) {
        const ax = (g[i].lon - lon) * kx, ay = (g[i].lat - lat) * KY, bx = (g[i + 1].lon - lon) * kx, by = (g[i + 1].lat - lat) * KY;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (!best || d < best.d) best = { d, along: g.cum[i] + t * (g.cum[i + 1] - g.cum[i]), brg: Math.atan2(dx, dy), i, t };
      }
      best.s = best.along / g.geoLen * e.len; return best;
    }
    function posOn(eid, s) { // point at distance s (edge units) along an edge
      const g = geom(eid), e = NET.edges[eid], a = Math.max(0, Math.min(g.geoLen, s / e.len * g.geoLen));
      for (let i = 0; i < g.length - 1; i++) if (g.cum[i + 1] >= a) { const t = (a - g.cum[i]) / ((g.cum[i + 1] - g.cum[i]) || 1); return { lat: g[i].lat + t * (g[i + 1].lat - g[i].lat), lon: g[i].lon + t * (g[i + 1].lon - g[i].lon), ang: Math.atan2(-(g[i + 1].lat - g[i].lat), (g[i + 1].lon - g[i].lon) * Math.cos(g[i].lat * Math.PI / 180)) }; }
      const p = g[g.length - 1]; return { lat: p.lat, lon: p.lon, ang: 0 };
    }
    let ADJ = null; const adj = () => ADJ || (ADJ = E.adjacency(NET));
    // shortest connection (by length) from the end of edge a to the start of edge b, at most maxKm – returns the edges in between, or null
    function connect(a, b, maxKm) {
      const A = adj(), start = NET.edges[a].to, goal = NET.edges[b].from;
      if (start === goal) return [];
      const dist = new Map([[start, 0]]), prev = new Map(), heap = [[0, start]];
      while (heap.length) {
        heap.sort((x, y) => x[0] - y[0]); const [d, n] = heap.shift();
        if (n === goal) { const out = []; let k = n; while (prev.has(k)) { const eid = prev.get(k); out.unshift(eid); k = NET.edges[eid].from; } return out; }
        if (d > (dist.get(n) ?? Infinity) || d > maxKm) continue;
        for (const eid of A[n] || []) { const e = NET.edges[eid], nd = d + e.len; if (nd < (dist.get(e.to) ?? Infinity) && nd <= maxKm) { dist.set(e.to, nd); prev.set(e.to, eid); heap.push([nd, e.to]); } }
      }
      return null;
    }
    const angDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };

    /* One GPS fix → updates the matcher state st (plain object, kept in localStorage).
       fix = { lat, lon, acc (m), t (minutes since midnight, fractional), speed (m/s or null) }
       Returns { obs: [new segment observations], changed: bool } */
    function update(st, fix, prefer) {   // prefer: Set of edges of the planned route (a mild prior)
      const res = { obs: [], changed: false };
      if (!(fix.acc <= 80)) return res;
      const prev = st.last, moved = prev ? E.haversine(prev, fix) : 0, dt = prev ? fix.t - prev.t : 0;
      // movement bearing from the last fix (only when clearly moving)
      let brg = null; if (prev && moved > 0.015) { brg = Math.atan2((fix.lon - prev.lon) * KX(fix.lat), (fix.lat - prev.lat) * KY); st.brg = brg; st.brgAt = fix.t; }
      else if (st.brg != null && fix.t - st.brgAt < 1) brg = st.brg;     // stopped in traffic: keep the last heading for a minute
      // speed (km/h): GPS value when available, otherwise from consecutive fixes
      // viteza: din GPS dacă telefonul o dă; altfel din deplasarea pe ultimele ~15 s. Pe loc, „zgomotul” GPS
      // (câțiva metri între citiri) nu trebuie să pară mers: sub precizia GPS considerăm viteza 0.
      st.win = (st.win || []).filter(p => fix.t - p.t <= 0.25).concat([{ lat: fix.lat, lon: fix.lon, t: fix.t }]);
      let v = null;
      if (fix.speed != null && fix.speed >= 0) v = fix.speed * 3.6;
      else if (st.win.length >= 4) { // media primei jumătăți vs a celei de-a doua: zgomotul se reduce, mersul rămâne
        const h = Math.floor(st.win.length / 2), avg = arr => ({ lat: arr.reduce((s, p) => s + p.lat, 0) / arr.length, lon: arr.reduce((s, p) => s + p.lon, 0) / arr.length, t: arr.reduce((s, p) => s + p.t, 0) / arr.length });
        const A = avg(st.win.slice(0, h)), B = avg(st.win.slice(h)), dtw = B.t - A.t, dw = E.haversine(A, B);
        if (dtw >= 0.03) v = dw < Math.max(0.02, 1.2 * fix.acc / 1000) ? 0 : dw / dtw * 60; }
      if (v != null && v < 4) v = 0;
      if (v != null && v < 250) { st.v = st.v == null || v === 0 ? v : 0.6 * v + 0.4 * st.v; st.vAt = fix.t; }
      // distanța parcursă, din GPS: adun doar pașii mai mari decât precizia (fără „zgomotul” de pe loc)
      if (fix.acc <= 50) { const w3 = st.win.slice(-3), sm = { lat: w3.reduce((s, p) => s + p.lat, 0) / w3.length, lon: w3.reduce((s, p) => s + p.lon, 0) / w3.length };
        if (!st.anchor) st.anchor = sm; else { const d = E.haversine(st.anchor, sm); if (d >= Math.max(0.03, 1.5 * fix.acc / 1000)) { st.dist = (st.dist || 0) + d; st.anchor = sm; } } }
      const r = Math.min(0.09, Math.max(0.035, fix.acc / 1000 * 1.5));
      let best = null;
      // the current edge and the ones right after it stay candidates over a wider radius (continuity)
      const cont = new Set(); if (st.eid) { cont.add(st.eid); const A = adj(); for (const e1 of A[NET.edges[st.eid].to] || []) { cont.add(e1); for (const e2 of A[NET.edges[e1].to] || []) if (NET.edges[e1].len < 0.15) cont.add(e2); } }
      for (const eid of near(fix.lat, fix.lon)) {
        const p = projEdge(eid, fix.lat, fix.lon); if (p.d > (cont.has(eid) ? r + 0.04 : r)) continue;
        if (brg != null && angDiff(brg, p.brg) > (moved > 0.04 ? 1.1 : 1.75)) continue; // wrong direction / cross street
        let pen = 0, conn = null;
        if (st.eid && eid !== st.eid) {
          conn = connect(st.eid, eid, Math.max(0.6, moved * 2.5 + 0.3));
          const cur = NET.edges[st.eid], rev = NET.edges[eid].from === cur.to && NET.edges[eid].to === cur.from;
          if (conn) { const D = (cur.len - st.s) + conn.reduce((s, e) => s + NET.edges[e].len, 0) + p.s; pen = 0.012 + 0.004 * conn.length + 0.5 * Math.abs(D - moved) + (rev ? 0.1 : 0); }
          else pen = 0.08;
        }
        if (st.eid && eid === st.eid && p.s < st.s - 0.05) pen = 0.03;        // going backwards on the same edge: unlikely
        const sc = p.d + pen - (prefer && prefer.has(eid) ? 0.012 : 0); if (!best || sc < best.sc) best = { eid, p, sc, conn };
      }
      st.last = { lat: fix.lat, lon: fix.lon, t: fix.t };
      if (!best) { st.unmatched = (st.unmatched || 0) + 1; return res; }
      st.unmatched = 0;
      const { eid, p } = best;
      if (!st.eid) { Object.assign(st, { eid, s: p.s, entry: p.s < 0.04 ? fix.t : null, sAt: fix.t, driven: [eid], km: 0 }); res.changed = true; return res; }
      if (eid === st.eid) { if (p.s > st.s) { st.km += p.s - st.s; st.s = p.s; st.sAt = fix.t; } return res; }
      // edge change: interpolate the crossing times along the distance driven since the last matched position
      const cur = NET.edges[st.eid], conn = best.conn;
      const Dc = conn ? (cur.len - st.s) + conn.reduce((x, e) => x + NET.edges[e].len, 0) + p.s : 0;
      if (conn && Dc <= 1.8 * Math.max(moved, E.haversine(posOn(st.eid, st.s), fix)) + 0.15) {
        const seq = [st.eid].concat(conn), D = (cur.len - st.s) + conn.reduce((s, e) => s + NET.edges[e].len, 0) + p.s, T = fix.t - st.sAt, rate = D > 0 ? T / D : 0;
        let t = st.sAt + (cur.len - st.s) * rate;                             // end of the current edge
        if (st.entry != null && t > st.entry) res.obs.push({ segId: st.eid, t: st.entry, dur: t - st.entry, interp: false });
        for (const c of conn) { const t2 = t + NET.edges[c].len * rate; if (T <= 3 && D <= 1.5) res.obs.push({ segId: c, t, dur: t2 - t, interp: true }); t = t2; st.driven.push(c); }
        st.km += D; st.entry = t;
      } else { st.entry = null; st.gaps = (st.gaps || 0) + 1;}
      st.driven.push(eid); st.eid = eid; st.s = p.s; st.sAt = fix.t; res.changed = true;
      const VMAX = { A: 150, C: 130, N: 120, J: 100, M: 90, B: 80 };  // peste aceste viteze, potrivirea e greșită
      res.obs = res.obs.filter(o => o.dur > 0.02 && NET.edges[o.segId].len / o.dur * 60 <= (VMAX[NET.edges[o.segId].cls] || 100));
      return res;
    }
    // position to draw: on the matched edge, or the raw fix if not matched
    function position(st) { return st.eid ? posOn(st.eid, st.s) : st.last ? { lat: st.last.lat, lon: st.last.lon, ang: 0 } : null; }
    return { geom, near, inBox, projEdge, posOn, connect, update, position };
  }
  const api = { createTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PLTTrack = api;
})(typeof self !== 'undefined' ? self : this);
