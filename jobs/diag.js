/* Manual diagnosis (workflow "diagnose"): compares what participants measured with what the a-priori model predicted.
   Prints only aggregates (ratios, km, minutes per road) – no participant codes, no places, no dates (the repo is public). */
global.self = global;
const E = require('../engine.js');
const graph = require('../graph.json');
const { createClient } = require('@supabase/supabase-js');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('missing secrets'); process.exit(0); }
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const q = async t => { const { data, error } = await db.from(t).select('*'); if (error) throw new Error(t + ': ' + error.message); return data || []; };
  const [trips, segs] = await Promise.all([q('trips'), q('segment_observations')]);
  const m0 = new E.Model(graph, []);
  console.log(`trips: ${trips.length}, segment observations: ${segs.length}`);
  trips.forEach((t, i) => {
    const ok = t.path && t.path.every(e => graph.edges[e]); if (!ok) { console.log(`trip ${i + 1}: route not in graph`); return; }
    const ctx = E.ctxFor(t.trip_date, t.weather || 'senin', false), w = m0.walk(t.path, t.trip_date, t.dep_min, ctx), km = E.pathLen(graph, t.path);
    const p = t.pred || {};
    console.log(`trip ${i + 1}: ${E.dayType(t.trip_date)} ${String(Math.floor(t.dep_min / 60)).padStart(2, '0')}h · ${km.toFixed(1)} km · measured ${t.dur_min.toFixed(0)} min (${(km / t.dur_min * 60).toFixed(1)} km/h) · model ${w.total.toFixed(0)} min (${(km / w.total * 60).toFixed(1)} km/h) · archived prediction ${p.median != null ? p.median.toFixed(0) : '-'} min · measured/model ${(t.dur_min / w.total).toFixed(2)} · gps ${p.gps ? 'yes' : 'no'}, off-route ${p.offRoute ? 'yes' : 'no'}, segments ${p.segments ?? '-'}`);
  });
  const road = {};
  for (const s of segs) { const e = graph.edges[s.seg_id]; if (!e) continue; const ctx = E.ctxFor(s.obs_date, s.weather || 'senin', false), ex = m0.segState(s.seg_id, s.obs_date, s.entry_min, ctx).med;
    const k = (e.name || '(fără nume)') + ' [' + e.cls + ']'; road[k] = road[k] || { km: 0, obs: 0, mod: 0, n: 0 }; road[k].km += e.len; road[k].obs += s.dur_min; road[k].mod += ex; road[k].n++; }
  console.log('\nroad · km · measured min · model min · measured km/h · model km/h · ratio');
  Object.entries(road).sort((a, b) => b[1].km - a[1].km).forEach(([k, r]) => console.log(`${k} · ${r.km.toFixed(2)} · ${r.obs.toFixed(1)} · ${r.mod.toFixed(1)} · ${(r.km / r.obs * 60).toFixed(1)} · ${(r.km / r.mod * 60).toFixed(1)} · ${(r.obs / r.mod).toFixed(2)}`));
})().catch(e => { console.error(e.message); process.exit(1); });
