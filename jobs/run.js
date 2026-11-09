/* Scheduled job (GitHub Actions, every 10 min): retrain on all trips, forecast each participant's habits,
   send web-push alerts (before departure and the evening before). Logs contain counts only – the repo is public. */
global.self = global;
const E = require('../engine.js');
const PLT = require('../forecast.js');
const graph = require('../graph.json');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const MISSING = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter(k => !process.env[k]);
if (MISSING.length) { console.log('Not configured yet (missing secrets: ' + MISSING.join(', ') + ') – nothing to do.'); process.exit(0); }
const env = k => process.env[k];
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://florian-cristian-dinca.github.io/pleaca-la-timp/', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

function localNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
/* vremea pe ore pentru București + Ilfov (Open-Meteo, 5 puncte). Pentru fiecare oră: cea mai grea categorie întâlnită
   în cel puțin 2 puncte, altfel cea din centru. Fără cheie, fără date despre participanți. */
async function fetchWeather() {
  const P = [[44.43, 26.10], [44.62, 26.05], [44.45, 26.30], [44.28, 26.10], [44.44, 25.90]];
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + P.map(p => p[0]).join(',') + '&longitude=' + P.map(p => p[1]).join(',') +
    '&hourly=weather_code,precipitation,snowfall,visibility,temperature_2m,relative_humidity_2m&timezone=Europe%2FBucharest&forecast_days=3';
  try {
    const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); let j = await r.json(); if (!Array.isArray(j)) j = [j];
    const W = {}, H = j[0].hourly;
    H.time.forEach((ts, i) => {
      const date = ts.slice(0, 10), h = +ts.slice(11, 13), cats = j.map(x => PLT.wxCode(x.hourly.weather_code[i], x.hourly.precipitation[i], x.hourly.snowfall[i], x.hourly.visibility[i], x.hourly.temperature_2m[i]));
      let pick = ['senin', '']; for (const c of cats) if (PLT.WX_SEV[c[0]] > PLT.WX_SEV[pick[0]] && cats.filter(x => x[0] === c[0]).length >= (c[0] === 'ceata' ? 3 : 2)) pick = c;   // ceața: doar dacă e prognozată în majoritatea zonei (prognoza ei e cea mai nesigură)
      const d = W[date] || (W[date] = { h: Array(24).fill('senin'), d: Array(24).fill(''), t: Array(24).fill(null), rh: Array(24).fill(null) }); d.h[h] = pick[0]; d.d[h] = pick[1];
      d.t[h] = Math.min(...j.map(x => x.hourly.temperature_2m[i])); d.rh[h] = Math.max(...j.map(x => x.hourly.relative_humidity_2m[i]));   // cel mai rece / cel mai umed punct
    });
    return W;
  } catch (e) { console.log('weather: ' + e.message); return null; }
}
const VMAX = { A: 150, C: 130, N: 120, J: 100, M: 90, B: 80 };   // implausible speeds = bad GPS matching
const addDays = (d, k) => E.dateFromIndex(E.dayIndex(d) + k);
const wday = d => new Date(d + 'T12:00:00Z').getUTCDay();
const toMin = t => PLT.parseT(String(t).slice(0, 5));
async function all(table, q = x => x) { // PostgREST returns at most 1000 rows per request: page through
  const out = []; for (let i = 0; ; i += 1000) { const { data, error } = await q(db.from(table).select('*')).range(i, i + 999); if (error) throw new Error(table + ': ' + error.message); out.push(...(data || [])); if (!data || data.length < 1000) return out; }
}

(async () => {
  const now = localNow(), today = now.date, tomorrow = addDays(today, 1), since = addDays(today, -200);
  const [parts, habits, trips, segs, reports, subs, packs] = await Promise.all([
    all('participants'), all('habits'), all('trips', q => q.gte('trip_date', since)), all('segment_observations', q => q.gte('obs_date', since)),
    all('reports', q => q.gte('start_date', addDays(today, -2))), all('push_subscriptions'),
    db.from('model_packs').select('*').neq('version', 'live').order('created_at', { ascending: false }).limit(1).then(r => { if (r.error) throw new Error('model_packs: ' + r.error.message); return r.data || []; })
  ]);
  const sent = new Set((await all('sent_alerts', q => q.gte('sent_at', new Date(Date.now() - 3 * 864e5).toISOString()))).map(r => r.participant + '|' + r.alert_key));

  // 1) restrictions reported by participants (active today/tomorrow)
  const restr = reports.filter(r => r.closed_lanes > 0 && graph.edges[r.seg_id] && (!r.end_date || r.end_date >= today))
    .map(r => ({ id: r.id, segId: r.seg_id, closedLanes: r.closed_lanes, startDate: r.start_date, startMin: r.start_min, endDate: r.end_date, endMin: r.end_min || 0, source: 'raportată', note: 'Raport participant: ' + r.kind + (graph.edges[r.seg_id].name ? ' pe ' + graph.edges[r.seg_id].name : '') }));

  const WX = await fetchWeather();
  if (WX) console.log('weather: ' + Object.entries(WX).map(([d, x]) => d + ' ' + [...new Set(x.d.filter(Boolean))].join('/') ).join('; '));
  // 1b) live traffic for the app: median speed per road segment in the last 45 min (only where ≥ 2 participants
  //     measured it, so nobody's own trip can be read from it) and the reports still active today (all kinds)
  {
    const rec = segs.filter(s => s.obs_date === today && s.entry_min >= now.min - 45 && s.entry_min <= now.min + 2 && graph.edges[s.seg_id] && graph.edges[s.seg_id].len / s.dur_min * 60 <= (VMAX[graph.edges[s.seg_id].cls] || 100));
    const by = {}; for (const s of rec) { const b = by[s.seg_id] || (by[s.seg_id] = { v: [], p: new Set() }); b.v.push(graph.edges[s.seg_id].len / s.dur_min * 60); b.p.add(s.participant); }
    const edges = {}; for (const [k, b] of Object.entries(by)) if (b.p.size >= 2) { b.v.sort((x, y) => x - y); edges[k] = [Math.round(b.v[Math.floor(b.v.length / 2)]), b.v.length]; }
    const ACT = { coada: 60, accident: 90, politie: 45, pericol: 60, banda: 240, lucrari: 480 };
    const notices = reports.filter(r => graph.edges[r.seg_id] && r.start_date === today && r.start_min <= now.min && now.min < (r.end_date === today && r.end_min != null ? r.end_min : r.start_min + (ACT[r.kind] || 60)))
      .map(r => ({ segId: r.seg_id, kind: r.kind, startMin: r.start_min, closedLanes: r.closed_lanes }));
    const { error } = await db.from('model_packs').upsert({ version: 'live', pack: { format: 'mpred-live', date: today, at: now.min, edges, notices, weather: WX, weatherSource: 'Open-Meteo.com (CC BY 4.0)' } });
    if (error) console.log('live: ' + error.message); else console.log(`live: ${Object.keys(edges).length} segments, ${notices.length} reports`);
  }

  // 2) retrain when the data changed (or once a day at 03:xx)
  const model = new E.Model(graph, restr), model0 = new E.Model(graph, []);
  const T = trips.filter(t => t.path && t.path.every(e => graph.edges[e]) && !(t.pred && t.pred.offRoute) && t.dur_min >= 2 && E.pathLen(graph, t.path) / t.dur_min * 60 <= 130).map(t => ({ id: t.id, date: t.trip_date, dep: t.dep_min, dur: t.dur_min, orig: t.origin_node, dest: t.dest_node, path: t.path, weather: t.weather || 'senin' }));
  const S = segs.filter(s => graph.edges[s.seg_id] && s.dur_min > 0.02 && graph.edges[s.seg_id].len / s.dur_min * 60 <= (VMAX[graph.edges[s.seg_id].cls] || 100) && graph.edges[s.seg_id].len / s.dur_min * 60 >= 2).map(s => ({ segId: s.seg_id, date: s.obs_date, t: s.entry_min, dur: s.dur_min, weather: s.weather }));
  let pack = packs[0] ? packs[0].pack : null;
  const sig = E.hash(JSON.stringify([T.length, S.length, restr.map(r => r.id), graph.meta.built, E.VERSION]));
  if (!pack || pack.sig !== sig || (now.min >= 180 && now.min < 190)) {
    const L = T.length ? E.train(model, T, S, { tau: 0.95 }) : null;
    pack = { format: 'mpred-model', sig, version: L ? L.version : 'a-priori-' + sig, exportedAt: new Date().toISOString(), tau: 0.95, lr: L ? L.lr : null, conf: L ? L.conf : null, trainedOn: T.length, restrictions: restr, edgeEdits: {}, weather: {} };
    const { error } = await db.from('model_packs').upsert({ version: pack.version + '-' + sig, pack });
    if (error) throw new Error('model_packs: ' + error.message);
    console.log(`model updated: ${T.length} trips, ${S.length} segment observations, ${restr.length} active reports`);
  }

  // 3) forecasts + alerts (only inside the relevant time windows)
  const fc = PLT.createForecaster({ E, net: graph, model, model0, pack, version: pack.version, weatherFor: (d, t) => PLT.wxAt(WX, d, t) || 'senin', weatherSpan: (d, a, b) => PLT.wxSpan(WX, d, a, b) });
  // încetinire măsurată acum: timpii pe tronsoane trimiși de participanți în ultimele 75 de minute, față de o zi obișnuită
  const ctxT = E.ctxFor(today, 'senin', false), ratio = {};
  for (const s of S) { if (s.date !== today || s.t < now.min - 75 || s.t > now.min) continue; const ex = model0.segState(s.segId, today, s.t, ctxT).med; if (ex > 0.05) (ratio[s.segId] = ratio[s.segId] || []).push(s.dur / ex); }
  for (const k in ratio) { const a = ratio[k].sort((x, y) => x - y); ratio[k] = a[Math.floor(a.length / 2)]; }
  const liveFor = path => { const w = model.walk(path, today, now.min, E.ctxFor(today, 'senin', false)); let extra = 0; const road = {};
    for (const p of w.parts) { const r = ratio[p.eid]; if (r && r >= 1.15) { extra += p.med * (r - 1); const nm = graph.edges[p.eid].name; if (nm) { road[nm] = road[nm] || { len: 0, r: 0 }; road[nm].len += graph.edges[p.eid].len; road[nm].r = Math.max(road[nm].r, r); } } }
    const top = Object.entries(road).sort((a, b) => b[1].len - a[1].len)[0];
    return { extra, road: top ? top[0] : null, drop: top ? 1 - 1 / top[1].r : 0 }; };
  const byP = {}; for (const s of subs) (byP[s.participant] = byP[s.participant] || []).push(s);
  let n = 0, fails = 0, gone = 0;
  const send = async (pid, key, msg) => {
    if (sent.has(pid + '|' + key)) return;
    for (const s of byP[pid] || []) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: msg.title, body: msg.body, tag: key, urgent: !!msg.urgent, speak: msg.urgent ? msg.body : null }), { urgency: msg.urgent ? 'high' : 'normal', TTL: 3 * 3600 }); n++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { gone++; await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint); } else fails++; }
    }
    await db.from('sent_alerts').upsert({ participant: pid, alert_key: key });
  };
  for (const p of parts) {
    if (!byP[p.id]) continue;
    for (const hr of habits.filter(h => h.participant === p.id)) {
      if (!graph.nodes[hr.origin_node] || !graph.nodes[hr.dest_node]) continue;
      const h = { id: String(hr.id), name: hr.name, o: hr.origin_node, d: hr.dest_node, ta: String(hr.arrive_by).slice(0, 5), usual: String(hr.usual_departure).slice(0, 5), days: hr.days };
      const usual = toMin(h.usual);
      if (h.days.includes(wday(today)) && E.dayType(today) !== 'D' && now.min >= usual - 150 && now.min <= usual + 5) {
        const f = fc.forecast(h, today), d = PLT.decision(f, h);
        const u = f && PLT.urgent(f, h, liveFor(f.cur.path));          // a apărut între timp ceva grav?
        if (u && now.min < usual) await send(p.id, `${h.id}|${today}|u`, { title: u.title, body: u.text, urgent: true });
        else if (d && now.min >= d.leave - p.lead_min && now.min < d.leave + 5) await send(p.id, `${h.id}|${today}|m`, d.morning);
      }
      const ev = toMin(p.evening_at);
      if (p.evening_alert && h.days.includes(wday(tomorrow)) && E.dayType(tomorrow) !== 'D' && now.min >= ev && now.min < ev + 60) {
        const f = fc.forecast(h, tomorrow), d = PLT.decision(f, h);
        const u = PLT.urgent(f, h, null);
        if (u) await send(p.id, `${h.id}|${tomorrow}|e`, { title: '⚠️ Mâine: ' + u.title.replace('⚠️ ', '').toLowerCase(), body: u.text.replace('Dacă plecați', 'Mâine, dacă plecați'), urgent: true });
        else if (d && (f.level !== 'g' || (f.wx && f.wx.cat !== 'ploaie'))) await send(p.id, `${h.id}|${tomorrow}|e`, d.evening);   // aglomerație sau vreme grea (ceață, ploaie torențială, ninsoare, polei)
      }
    }
  }
  // 4) familie: anunț membrii când cineva a plecat / a ajuns; șterg pozițiile neactualizate de 10 minute (tabelele pot lipsi încă)
  try {
    const old = new Date(Date.now() - 10 * 60e3).toISOString();
    await db.from('live_positions').delete().lt('updated_at', old);
    const [{ data: mem, error: e1 }, { data: pos, error: e2 }] = await Promise.all([db.from('family_members').select('*'), db.from('live_positions').select('*')]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    let fam = 0;
    for (const p of pos || []) {
      const m = (mem || []).find(x => x.participant === p.participant); if (!m || !m.approved || !m.sharing) continue;
      const age = (Date.now() - new Date(p.updated_at).getTime()) / 60000; if (age > 10) continue;
      const arrived = p.status === 'a ajuns', key = `fam|${p.participant}|${p.day}|${p.dest_name}|${arrived ? 'arr' : 'dep'}`;
      const msg = arrived ? { title: `👪 ${m.display_name} a ajuns`, body: `${m.display_name} a ajuns la ${p.dest_name}.` }
        : { title: `👪 ${m.display_name} a plecat`, body: `${m.display_name} e pe drum spre ${p.dest_name}, sosire estimată în jur de ${PLT.fmt(Math.round(p.eta_min))}.` };
      for (const o of (mem || []).filter(x => x.family === m.family && x.participant !== p.participant && x.approved)) { await send(o.participant, key, msg); fam++; }
    }
    if (fam) console.log(`family notices: ${fam}`);
  } catch (e) { if (!/does not exist|schema cache/.test(e.message)) console.log('family: ' + e.message); }
  console.log(`run ${today} ${PLT.fmt(now.min)}: participants ${parts.length}, notifications sent ${n}, failed ${fails}, expired ${gone}`);
})().catch(e => { console.error('job failed:', e.message, e.stack); process.exit(1); });
