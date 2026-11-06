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
const addDays = (d, k) => E.dateFromIndex(E.dayIndex(d) + k);
const wday = d => new Date(d + 'T12:00:00Z').getUTCDay();
const toMin = t => PLT.parseT(String(t).slice(0, 5));
async function all(table, q = x => x) { const { data, error } = await q(db.from(table).select('*')); if (error) throw new Error(table + ': ' + error.message); return data || []; }

(async () => {
  const now = localNow(), today = now.date, tomorrow = addDays(today, 1), since = addDays(today, -200);
  const [parts, habits, trips, segs, reports, subs, packs] = await Promise.all([
    all('participants'), all('habits'), all('trips', q => q.gte('trip_date', since)), all('segment_observations', q => q.gte('obs_date', since)),
    all('reports', q => q.gte('start_date', addDays(today, -2))), all('push_subscriptions'),
    all('model_packs', q => q.order('created_at', { ascending: false }).limit(1))
  ]);
  const sent = new Set((await all('sent_alerts', q => q.gte('sent_at', new Date(Date.now() - 3 * 864e5).toISOString()))).map(r => r.participant + '|' + r.alert_key));

  // 1) restrictions reported by participants (active today/tomorrow)
  const restr = reports.filter(r => r.closed_lanes > 0 && graph.edges[r.seg_id] && (!r.end_date || r.end_date >= today))
    .map(r => ({ id: r.id, segId: r.seg_id, closedLanes: r.closed_lanes, startDate: r.start_date, startMin: r.start_min, endDate: r.end_date, endMin: r.end_min || 0, source: 'raportată', note: 'Raport participant: ' + r.kind + (graph.edges[r.seg_id].name ? ' pe ' + graph.edges[r.seg_id].name : '') }));

  // 2) retrain when the data changed (or once a day at 03:xx)
  const model = new E.Model(graph, restr), model0 = new E.Model(graph, []);
  const T = trips.filter(t => t.path && t.path.every(e => graph.edges[e]) && !(t.pred && t.pred.offRoute)).map(t => ({ id: t.id, date: t.trip_date, dep: t.dep_min, dur: t.dur_min, orig: t.origin_node, dest: t.dest_node, path: t.path, weather: t.weather || 'senin' }));
  const S = segs.filter(s => graph.edges[s.seg_id]).map(s => ({ segId: s.seg_id, date: s.obs_date, t: s.entry_min, dur: s.dur_min, weather: s.weather }));
  let pack = packs[0] ? packs[0].pack : null;
  const sig = E.hash(JSON.stringify([T.length, S.length, restr.map(r => r.id), graph.meta.built]));
  if (!pack || pack.sig !== sig || (now.min >= 180 && now.min < 190)) {
    const L = T.length ? E.train(model, T, S, { tau: 0.95 }) : null;
    pack = { format: 'mpred-model', sig, version: L ? L.version : 'a-priori-' + sig, exportedAt: new Date().toISOString(), tau: 0.95, lr: L ? L.lr : null, conf: L ? L.conf : null, trainedOn: T.length, restrictions: restr, edgeEdits: {}, weather: {} };
    const { error } = await db.from('model_packs').upsert({ version: pack.version + '-' + sig, pack });
    if (error) throw new Error('model_packs: ' + error.message);
    console.log(`model updated: ${T.length} trips, ${S.length} segment observations, ${restr.length} active reports`);
  }

  // 3) forecasts + alerts (only inside the relevant time windows)
  const fc = PLT.createForecaster({ E, net: graph, model, model0, pack, version: pack.version });
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
        else if (d && f.level !== 'g') await send(p.id, `${h.id}|${tomorrow}|e`, d.evening);
      }
    }
  }
  console.log(`run ${today} ${PLT.fmt(now.min)}: participants ${parts.length}, notifications sent ${n}, failed ${fails}, expired ${gone}`);
})().catch(e => { console.error('job failed:', e.message); process.exit(1); });
