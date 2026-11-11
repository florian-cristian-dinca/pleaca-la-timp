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
  { const c = await db.from('live_positions').select('rem_km,cost_lei,cost_total_lei,driven_km').limit(1); console.log('schema family2 (rem_km, cost_lei…):', c.error ? 'MISSING – ' + c.error.message : 'ok');
    const f = await db.rpc('report_feedback', { rid: '__none__', still: true }); console.log('schema feedback:', f.error && /function|exist/i.test(f.error.message) && !/neautentificat/.test(f.error.message) ? 'MISSING – ' + f.error.message : 'ok');
    const lt = await db.rpc('live_traffic'); console.log('schema live_traffic:', lt.error ? 'MISSING – ' + lt.error.message : 'ok');
    const last = trips.slice().sort((a, b) => (a.trip_date + String(a.dep_min).padStart(5, '0')).localeCompare(b.trip_date + String(b.dep_min).padStart(5, '0'))).slice(-3);
    last.forEach(t => console.log(`recent trip: ${E.dayType(t.trip_date)} ${String(Math.floor(t.dep_min / 60)).padStart(2, '0')}h, ${t.dur_min.toFixed(0)} min, segments ${(t.path || []).length}, pred keys: ${Object.keys(t.pred || {}).join(',')}, uploaded ${String(t.created_at || '').slice(11, 16)}Z`)); }
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
  // evaluare „ca în realitate” (walk-forward): fiecare drum e prezis DOAR din datele de dinainte de el
  const ord = T.map((t, i) => ({ t, i })).sort((a, b) => a.t.date.localeCompare(b.t.date) || a.t.dep - b.t.dep);
  const before = (d, m) => x => x.date < d || (x.date === d && x.t < m);
  const wf = [];
  ord.forEach(({ t }, k) => {
    const Tp = ord.slice(0, k).map(o => o.t), Sp = S.filter(before(t.date, t.dep)), ctx = E.ctxFor(t.date, t.weather, false), w = m0.walk(t.path, t.date, t.dep, ctx);
    const Lk = Tp.length || Sp.length ? E.train(m0, Tp, Sp, { tau: 0.95 }) : null, pred = w.total * (Lk ? Math.exp(E.pathShift(Lk.lr, w.parts, t.date)) : 1);
    const arch = (trips.find(x => x.id === t.id) || {}).pred || {};
    wf.push({ date: t.date, dep: t.dep, dur: t.dur, prior: w.total, pred, arch: arch.median != null ? arch.median : null, nPrev: Tp.length, nSeg: Sp.length });
  });
  const e = (a, b) => Math.abs(a - b) / b;
  wf.forEach((x, k) => console.log(`wf ${k + 1}: ${E.dayType(x.date)} ${String(Math.floor(x.dep / 60)).padStart(2, '0')}h · learned from ${x.nPrev} trips/${x.nSeg} seg · measured ${x.dur.toFixed(0)} · a-priori ${x.prior.toFixed(0)} (${Math.round(e(x.prior, x.dur) * 100)}%) · learned ${x.pred.toFixed(0)} (${Math.round(e(x.pred, x.dur) * 100)}%)${x.arch != null ? ` · app said then ${x.arch.toFixed(0)} (${Math.round(e(x.arch, x.dur) * 100)}%)` : ''}`));
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN; };
  for (const [nm, part] of [['first half', wf.slice(0, Math.ceil(wf.length / 2))], ['second half', wf.slice(Math.ceil(wf.length / 2))], ['all', wf]])
    console.log(`wf summary ${nm} (${part.length} trips): median abs error a-priori ${Math.round(med(part.map(x => e(x.prior, x.dur))) * 100)}%, learned ${Math.round(med(part.map(x => e(x.pred, x.dur))) * 100)}%; within ±15%: a-priori ${part.filter(x => e(x.prior, x.dur) <= 0.15).length}, learned ${part.filter(x => e(x.pred, x.dur) <= 0.15).length}; app at the time: median ${Math.round(med(part.filter(x => x.arch != null).map(x => e(x.arch, x.dur))) * 100)}%`);
  // ambuteiajele pe tronsoane: ce culoare (verde/galben/roșu) ar fi arătat aplicația, învățând doar din zilele de dinainte, față de ce s-a măsurat
  const lvl = r => r >= 3 ? 'r' : r >= 2 ? 'y' : 'g', days = [...new Set(S.map(o => o.date))].sort(), cm = {};
  for (const d of days) {
    const Tp = T.filter(t => t.date < d), Sp = S.filter(o => o.date < d), Lk = Tp.length || Sp.length ? E.train(m0, Tp, Sp, { tau: 0.95 }) : null;
    for (const o of S.filter(x => x.date === d)) { const ed = graph.edges[o.segId], free = ed.len / ed.v0 * 60, ctx = E.ctxFor(o.date, o.weather, false);
      const p = m0.segState(o.segId, o.date, o.t, ctx).med * (Lk ? Math.exp(E.edgeBias(Lk.lr, o.segId, o.date, o.t)) : 1);
      const k = lvl(o.dur / free) + lvl(p / free); cm[k] = (cm[k] || 0) + ed.len; }
  }
  const g = k => (cm[k] || 0), tot2 = Object.values(cm).reduce((a, b) => a + b, 0) || 1;
  console.log(`jam km (measured→predicted): g→g ${g('gg').toFixed(0)}, g→y ${g('gy').toFixed(0)}, g→r ${g('gr').toFixed(0)} | y→g ${g('yg').toFixed(0)}, y→y ${g('yy').toFixed(0)}, y→r ${g('yr').toFixed(0)} | r→g ${g('rg').toFixed(0)}, r→y ${g('ry').toFixed(0)}, r→r ${g('rr').toFixed(0)} | agreement ${Math.round((g('gg') + g('yy') + g('rr')) / tot2 * 100)}%`);
  console.log('\nlearned road factors (×): ' + Object.entries(L.lr.R || {}).sort((a, b) => b[1].w - a[1].w).slice(0, 15).map(([k, v]) => `${k.split(':').slice(1).join(':')} ${Math.exp(v.b).toFixed(2)} (n=${v.w})`).join('; '));
  console.log('\nroad · km · measured min · model min · measured km/h · model km/h · ratio');
  Object.entries(road).sort((a, b) => b[1].km - a[1].km).forEach(([k, r]) => console.log(`${k} · ${r.km.toFixed(2)} · ${r.obs.toFixed(1)} · ${r.mod.toFixed(1)} · ${(r.km / r.obs * 60).toFixed(1)} · ${(r.km / r.mod * 60).toFixed(1)} · ${(r.obs / r.mod).toFixed(2)}`));
})().catch(e => { console.error(e.message); process.exit(1); });
