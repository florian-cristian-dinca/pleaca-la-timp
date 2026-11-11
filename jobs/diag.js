/* Manual diagnosis (workflow "diagnose"): compares what participants measured with what the a-priori model predicted.
   Prints only aggregates (ratios, km, minutes per road) – no participant codes, no places, no dates (the repo is public). */
global.self = global;
const E = require('../engine.js');
const graph = require('../graph.json');
const { createClient } = require('@supabase/supabase-js');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('missing secrets'); process.exit(0); }
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const q = async t => { const out = []; for (let i = 0; ; i += 1000) { const { data, error } = await db.from(t).select('*').range(i, i + 999); if (error) throw new Error(t + ': ' + error.message); out.push(...(data || [])); if (!data || data.length < 1000) return out; } };
  const [trips, segs] = await Promise.all([q('trips'), q('segment_observations')]);
  const m0 = new E.Model(graph, []);
  console.log(`trips: ${trips.length}, segment observations: ${segs.length}`);
  // de unde vin măsurătorile: pe participant, ANONIMIZAT (P1, P2… după volum) – fără coduri, nume, locuri sau date (jurnalul e public)
  let fam = [], fams = []; try { fam = await q('family_members'); fams = await q('families'); } catch (e) { }
  const per = {};
  for (const t of trips) { const p = per[t.participant] || (per[t.participant] = { trips: 0, obs: 0, km: 0, min: 0, hours: {} }); p.trips++; p.min += t.dur_min || 0; const h = Math.floor(t.dep_min / 60); p.hours[h] = (p.hours[h] || 0) + 1; }
  for (const o of segs) { const p = per[o.participant] || (per[o.participant] = { trips: 0, obs: 0, km: 0, min: 0, hours: {} }); p.obs++; if (graph.edges[o.seg_id]) p.km += graph.edges[o.seg_id].len; }
  const tot = Object.values(per).reduce((a, p) => a + p.obs, 0) || 1;
  Object.entries(per).sort((a, b) => b[1].obs - a[1].obs).forEach(([id, p], i) => {
    const fm = fam.find(f => f.participant === id);
    console.log(`source P${i + 1}: ${p.trips} trips (${Math.round(p.min)} min), ${p.obs} segment observations (${Math.round(p.obs / tot * 100)}%), ${p.km.toFixed(0)} km measured · departures at ${Object.keys(p.hours).sort((a, b) => a - b).map(h => h + 'h×' + p.hours[h]).join(' ')} · ${fm ? 'family group member' + (fm.minor ? ' (under 18)' : '') + (fams.some(f => f.id === fm.family && (f.owner === id || f.created_by === id)) ? ', group creator' : '') : 'not in a family group'}`);
  });
  trips.forEach((t, i) => {
    const ok = t.path && t.path.every(e => graph.edges[e]); if (!ok) { console.log(`trip ${i + 1}: route not in graph`); return; }
    const ctx = E.ctxFor(t.trip_date, t.weather || 'senin', false), w = m0.walk(t.path, t.trip_date, t.dep_min, ctx), km = E.pathLen(graph, t.path);
    const p = t.pred || {};
    console.log(`trip ${i + 1}: ${E.dayType(t.trip_date)} ${String(Math.floor(t.dep_min / 60)).padStart(2, '0')}h · ${km.toFixed(1)} km · measured ${t.dur_min.toFixed(0)} min (${(km / t.dur_min * 60).toFixed(1)} km/h) · model ${w.total.toFixed(0)} min (${(km / w.total * 60).toFixed(1)} km/h) · archived prediction ${p.median != null ? p.median.toFixed(0) : '-'} min · measured/model ${(t.dur_min / w.total).toFixed(2)} · gps ${p.gps ? 'yes' : 'no'}, off-route ${p.offRoute ? 'yes' : 'no'}, segments ${p.segments ?? '-'}`);
  });
  const road = {};
  for (const s of segs) { const e = graph.edges[s.seg_id]; if (!e) continue; const ctx = E.ctxFor(s.obs_date, s.weather || 'senin', false), ex = m0.segState(s.seg_id, s.obs_date, s.entry_min, ctx).med;
    const k = (e.name || '(fără nume)') + ' [' + e.cls + ']'; road[k] = road[k] || { km: 0, obs: 0, mod: 0, n: 0 }; road[k].km += e.len; road[k].obs += s.dur_min; road[k].mod += ex; road[k].n++; }
  // ce a învățat modelul din aceleași date (aceeași selecție ca serverul)
  const VMAX = { A: 150, C: 130, N: 120, J: 100, M: 90, B: 80 };
  const T = trips.filter(t => t.path && t.path.every(e => graph.edges[e]) && !(t.pred && t.pred.offRoute) && t.dur_min >= 2 && E.pathLen(graph, t.path) / t.dur_min * 60 <= 130).map(t => ({ id: t.id, date: t.trip_date, dep: t.dep_min, dur: t.dur_min, path: t.path, weather: t.weather || 'senin', vacation: false }));
  const S = segs.filter(s => graph.edges[s.seg_id] && s.dur_min > 0.02 && graph.edges[s.seg_id].len / s.dur_min * 60 <= (VMAX[graph.edges[s.seg_id].cls] || 100) && graph.edges[s.seg_id].len / s.dur_min * 60 >= 2).map(s => ({ segId: s.seg_id, date: s.obs_date, t: s.entry_min, dur: s.dur_min, weather: s.weather || 'senin' }));
  const L = E.train(m0, T, S, { tau: 0.95 });
  console.log(`\nlearned: ${Object.keys(L.lr.R || {}).length} roads, ${Object.keys(L.lr.L1).length} segments; calibrated: ${L.conf && L.conf.calibrated}`);
  let e0 = 0, e1 = 0;
  T.forEach((t, i) => { const ctx = E.ctxFor(t.date, t.weather, false), w = m0.walk(t.path, t.date, t.dep, ctx), learned = w.total * Math.exp(E.pathShift(L.lr, w.parts, t.date));
    e0 += Math.abs(Math.log(t.dur / w.total)); e1 += Math.abs(Math.log(t.dur / learned));
    console.log(`fit ${i + 1}: measured ${t.dur.toFixed(0)} · a-priori ${w.total.toFixed(0)} · learned ${learned.toFixed(0)} min`); });
  console.log(`mean |log error|: a-priori ${(e0 / T.length).toFixed(3)}, learned ${(e1 / T.length).toFixed(3)} (in-sample)`);
  console.log('\nlearned road factors (×): ' + Object.entries(L.lr.R || {}).sort((a, b) => b[1].w - a[1].w).slice(0, 15).map(([k, v]) => `${k.split(':').slice(1).join(':')} ${Math.exp(v.b).toFixed(2)} (n=${v.w})`).join('; '));
  console.log('\nroad · km · measured min · model min · measured km/h · model km/h · ratio');
  Object.entries(road).sort((a, b) => b[1].km - a[1].km).forEach(([k, r]) => console.log(`${k} · ${r.km.toFixed(2)} · ${r.obs.toFixed(1)} · ${r.mod.toFixed(1)} · ${(r.km / r.obs * 60).toFixed(1)} · ${(r.km / r.mod * 60).toFixed(1)} · ${(r.obs / r.mod).toFixed(2)}`));
})().catch(e => { console.error(e.message); process.exit(1); });
