/* Pleacă la timp – shared forecaster (browser + scheduled job). Depends on engine.js (E). */
(function (root) {
'use strict';
const LV = { g: ['Drum liniștit', '🟢'], y: ['Aglomerat', '🟡'], r: ['Ambuteiaj anunțat', '🔴'] };
const KIND_TXT = { banda: 'o bandă închisă', lucrari: 'lucrări', accident: 'un accident', coada: 'o coadă' };
const slotColor = s => s.idle < 10 ? '#4caf6e' : s.idle < 25 ? '#f0a83a' : '#d9534f';
const parseT = s => { const [h, m] = (s || '00:00').split(':').map(Number); return h * 60 + m; };
const fmt = m => { m = Math.round(m); const d = ((m % 1440) + 1440) % 1440; return String(Math.floor(d / 60)).padStart(2, '0') + ':' + String(d % 60).padStart(2, '0'); };
function createForecaster(o) {
  const E = o.E, NET = o.net, M = o.model, M0 = o.model0, version = o.version || '';
  const LR = () => (o.pack && o.pack.lr ? o.pack : null);
  const weatherFor = o.weatherFor || (() => 'senin');
  const CACHE = {}, PATHS = {};
  function slotEval(m, paths, date, t0, ctx, withQ) {
    let best = null;
    for (const path of paths) { const w = m.walk(path, date, t0, ctx); if (!best || w.total < best.w.total) best = { path, w }; }
    if (!best) return null;
    const { path, w } = best, L = LR(), eb = Math.exp(E.pathShift(L && L.lr, w.parts, date));
    const free = path.reduce((s, e) => s + NET.edges[e].len / NET.edges[e].v0 * 60, 0);
    const med = w.total * eb; let q;
    let samp = null, cal = false, medOut = med;
    if (withQ) {
      // O SINGURĂ distribuție pentru tot ce afișăm (ora de sosire, probabilitatea, cuantila de 95%):
      // corecția învățată (eb) și, doar dacă e calibrată pe date reale, marja conformă.
      const km = E.pathLen(NET, path), qc = E.qhatFor(L && L.conf, km); cal = !!qc.calibrated;
      const k = eb * (cal ? Math.exp(qc.qhat) : 1), pp = m.predictPath(path, date, t0, ctx, 400, 0.95);
      samp = pp.samples.map(x => x * k); medOut = E.quantile(samp, 0.5); q = E.quantile(samp, 0.95);
    }
    else q = med * 1.3; // estimare rapidă (ecranul „Săptămâna”)
    // drumul (după nume) pe care se pierde cel mai mult timp – se comunică doar numele, fără hartă
    const byName = {};
    for (const p of w.parts) { const e = NET.edges[p.eid], loss = p.med - e.len / e.v0 * 60, nm = e.name; if (!nm) continue; const b = byName[nm] || (byName[nm] = { loss: 0, eid: p.eid, max: -1e9, t: p.t }); b.loss += loss; if (loss > b.max) { b.max = loss; b.eid = p.eid; b.t = p.t; } }
    let worst = null; for (const [name, b] of Object.entries(byName)) if (!worst || b.loss > worst.loss) worst = { name, loss: b.loss, eid: b.eid, t: b.t };
    return { t0, path, med: medOut, q, free, idle: Math.max(0, medOut - free), worst, samp, cal };
  }
  function pathsFor(o, d, date, t, ctx) {
    const k = o + '>' + d + '|' + E.dayClass(date) + '|' + Math.round(t / 60);
    if (!PATHS[k]) PATHS[k] = M.alternatives(o, d, date, t, ctx, 3).map(a => a.path);
    return PATHS[k];
  }
  function forecast(h, date, light) {
    const key = (light ? 'L|' : '') + h.id + '|' + h.o + h.d + '|' + date + '|' + h.ta + '|' + h.usual + '|' + version;
    if (CACHE[key]) return CACHE[key];
    const ctx = E.ctxFor(date, weatherFor(date), false), ctx0 = E.ctxFor(date, 'senin', false), ta = parseT(h.ta), usual = parseT(h.usual), deadline = ta - (o.bufferMin || 0); // ora aleasă de utilizator, fără rezerve ascunse
    const from = Math.min(usual - 60, ta - 150), to = Math.max(usual + 60, ta + 30), slots = [];
    const paths = pathsFor(h.o, h.d, date, usual, ctx); if (!paths.length) return (CACHE[key] = null);
    for (let t = Math.round(from / 10) * 10; t <= to; t += 10) { const s = slotEval(M, paths, date, t, ctx, !light); if (s) slots.push(s); }
    if (!slots.length) return (CACHE[key] = null);
    const pOn = s => { if (!s || !s.samp) return; let k = 0; for (const x of s.samp) if (s.t0 + x <= deadline) k++; s.pOn = k / s.samp.length; s.samp = null; };
  slots.forEach(pOn);
  const near = t => slots.reduce((a, b) => Math.abs(b.t0 - t) < Math.abs(a.t0 - t) ? b : a);
    const cur = slotEval(M, paths, date, usual, ctx, !light), typ = slotEval(M0, paths, date, usual, ctx0, false);
  pOn(cur);
    // „la timp” = probabilitatea calculată față de ora aleasă ≥ 95% (≥ 97% cât timp modelul nu e verificat pe date reale)
    const safe = s => s.pOn != null ? s.pOn >= (s.cal ? 0.95 : 0.97) : s.t0 + s.q <= deadline;
    const feas = slots.filter(safe);
    // cea mai bună oră: la timp (cu marja de siguranță) și cu cât mai puțin timp pe loc; la egalitate, cea mai târzie
    const pool = feas.filter(s => s.t0 <= usual && s.t0 >= usual - 120);
    // cost = minute pe loc + 0,35 × minutele de așteptare la destinație (a sosi prea devreme are și el un cost)
    const cost = s => s.idle + 0.35 * Math.max(0, deadline - (s.t0 + s.med));
    let early = null; for (const s of pool) if (!early || cost(s) < cost(early) - 0.5 || (Math.abs(cost(s) - cost(early)) <= 0.5 && s.t0 > early.t0)) early = s;
    if (!early && feas.length) early = feas[feas.length - 1];
    const calm = slots.filter(s => s.t0 > usual && s.idle < 10)[0] || null;          // mai târziu, când se liniștește
    const lateBy = safe(cur) ? 0 : Math.max(0, cur.t0 + cur.q - deadline);
    const extra = cur.idle - typ.idle;
    const level = cur.idle >= 25 || lateBy >= 10 ? 'r' : cur.idle >= 10 || lateBy > 0 ? 'y' : 'g';
    // fereastra în care se formează coloana pe locul cel mai problematic
    let jam = null;
    if (cur.worst && cur.worst.loss > 3) { const nm = cur.worst.name, segs = cur.path.filter(x => NET.edges[x].name === nm); let a = null, b = null; for (let t = Math.max(240, usual - 120); t <= Math.min(1380, usual + 150); t += 5) { let loss = 0; for (const x of segs) { const e = NET.edges[x]; loss += M.segState(x, date, t, ctx).med - e.len / e.v0 * 60; } if (loss > Math.max(4, 0.5 * cur.worst.loss)) { if (a === null) a = t; b = t; } } if (a !== null) jam = { name: nm, a, b }; }
    const causes = [];
    for (const p of cur.path) for (const r of M.activeRestr(p, E.dayIndex(date) * 1440 + usual + 20).list) {
      const m = /^Raport participant: (\w+)/.exec(r.note || ''), road = NET.edges[r.segId] && NET.edges[r.segId].name;
      causes.push(m ? `${KIND_TXT[m[1]] || 'o problemă'}${road ? ' pe ' + road : ''} (semnalare de la participanți)` : (r.note || ('o bandă închisă' + (road ? ' pe ' + road : ''))));
    }
    const wx = weatherFor(date); if (wx !== 'senin') causes.push('vremea: ' + E.WEATHER[wx].label.toLowerCase());
    const res = { date, slots, cur, typ, early, calm, lateBy, extra, level, jam, causes: [...new Set(causes)], ta, usual, deadline, near };
    return (CACHE[key] = res);
  }
  const LV = { g: ['Drum liniștit', '🟢'], y: ['Aglomerat', '🟡'], r: ['Ambuteiaj anunțat', '🔴'] };
const KIND_TXT = { banda: 'o bandă închisă', lucrari: 'lucrări', accident: 'un accident', coada: 'o coadă' };
  const slotColor = s => s.idle < 10 ? '#4caf6e' : s.idle < 25 ? '#f0a83a' : '#d9534f';

  /* ---------- Ecranul „Avertizări” ---------- */
  return { forecast, slotEval, pathsFor };
}
/* ora la care trebuie plecat și textele avertizărilor (aceleași în aplicație și în notificări) */
function decision(f, h) {
  if (!f) return null;
  const leave = f.level === 'g' ? f.usual : (f.early ? f.early.t0 : f.slots[0].t0);
  const where = f.jam ? ` Coloana se formează pe ${f.jam.name}, între ${fmt(f.jam.a)} și ${fmt(f.jam.b)}.` : '';
  const unusual = f.extra >= 8 ? ` Neobișnuit: cu ${Math.round(f.extra)} min mai mult decât de obicei.` : '';
  return {
    leave, level: f.level,
    morning: { title: `${h.name}: pleacă la ${fmt(leave)}`, body: f.level === 'g' ? 'Drum liniștit, poți pleca la ora obișnuită.' : `${f.level === 'r' ? 'Ambuteiaj' : 'Aglomerație'} pe drumul tău.${where}${unusual}` },
    evening: { title: `Mâine: ${LV[f.level][0].toLowerCase()} · ${h.name.toLowerCase()}`, body: `Pleacă la ${fmt(leave)} în loc de ${h.usual}.${where}${unusual}` }
  };
}
const api = { createForecaster, decision, LV, slotColor, fmt, parseT };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PLT = api;
})(typeof self !== 'undefined' ? self : this);
