/* Pleacă la timp – shared forecaster (browser + scheduled job). Depends on engine.js (E). */
(function (root) {
'use strict';
const LV = { g: ['Drum liniștit', '🟢'], y: ['Aglomerat', '🟡'], r: ['Ambuteiaj anunțat', '🔴'] };
const KIND_TXT = { banda: 'o bandă închisă', lucrari: 'lucrări', accident: 'un accident', coada: 'o coadă', pericol: 'un obstacol pe carosabil', politie: 'un control al poliției' };
const slotColor = s => s.idle < 10 ? '#4caf6e' : s.idle < 25 ? '#f0a83a' : '#d9534f';
const parseT = s => { const [h, m] = (s || '00:00').split(':').map(Number); return h * 60 + m; };
const fmt = m => { m = Math.round(m); const d = ((m % 1440) + 1440) % 1440; return String(Math.floor(d / 60)).padStart(2, '0') + ':' + String(d % 60).padStart(2, '0'); };
/* vremea pe ore (Open-Meteo, prin server): categorie pentru model + cuvânt pentru om */
const WX_SEV = { senin: 0, ploaie: 1, ceata: 2, torential: 3, ninsoare: 4 };
const WX_ICON = { ceata: '🌫️', ploaie: '🌧️', torential: '⛈️', ninsoare: '❄️' };
function wxCode(code, prec, snow, vis, temp) { // → [categorie model, descriere]
  if ([66, 67, 56, 57].includes(code) || (temp <= 0.5 && prec >= 0.1 && !(snow > 0))) return ['ninsoare', 'polei'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86 || snow >= 0.1) return ['ninsoare', 'ninsoare'];
  if (code >= 95) return ['torential', 'furtună'];
  if (code === 65 || code === 82 || prec >= 7) return ['torential', 'ploaie torențială'];
  if (code === 45 || code === 48 || (vis != null && vis < 1000)) return ['ceata', 'ceață'];
  if ((code >= 61 && code <= 64) || code === 80 || code === 81 || prec >= 0.5) return ['ploaie', 'ploaie'];
  if (code >= 51 && code <= 55) return ['ploaie', 'burniță'];
  return ['senin', ''];
}
const hh = h => String(h % 24).padStart(2, '0') + ':00';
/* cea mai dificilă vreme într-un interval (minute) al unei zile: { cat, word, txt } sau null */
function wxSpan(W, date, a, b) {
  const d = W && W[date]; if (!d || !d.h) return null;
  let worst = null, h0 = null, h1 = null;
  for (let h = Math.max(0, Math.floor(a / 60)); h <= Math.min(23, Math.floor(b / 60)); h++) { const c = d.h[h]; if (!c || c === 'senin') continue; if (!worst || WX_SEV[c] > WX_SEV[worst.cat]) worst = { cat: c, word: d.d[h] }; }
  if (!worst) return null;
  for (let h = 0; h < 24; h++) if (d.h[h] === worst.cat) { if (h0 == null) h0 = h; h1 = h; }
  worst.txt = `${worst.word} între ${hh(h0)} și ${hh(h1 + 1)}`; worst.icon = WX_ICON[worst.cat] || '🌦️'; return worst;
}
function wxAt(W, date, t) { const d = W && W[date]; return d && d.h ? d.h[Math.min(23, Math.max(0, Math.floor(t / 60)))] || 'senin' : null; }
/* „sensul spre X”: localitatea spre care merge un tronson orientat (pentru a nu confunda sensurile de mers) */
const DIRCACHE = new Map();
function dirName(E, NET, eid) {
  if (DIRCACHE.has(eid)) return DIRCACHE.get(eid);
  const e = NET.edges[eid]; if (!e) return '';
  const a = NET.nodes[e.from]; let b = NET.nodes[e.to], len = e.len, cur = e, guard = 0;
  const A = NET.__adj || (NET.__adj = E.adjacency(NET));
  while (len < 2.5 && guard++ < 60) { // prelungesc pe același drum, ca direcția să nu depindă de un tronson scurt
    const nx = (A[cur.to] || []).map(k => NET.edges[k]).find(x => x.name && x.name === e.name && x.to !== cur.from);
    if (!nx) break; cur = nx; len += nx.len; b = NET.nodes[nx.to];
  }
  const kx = Math.cos(a.lat * Math.PI / 180), brg = Math.atan2((b.lon - a.lon) * kx, b.lat - a.lat);
  const deg = (brg * 180 / Math.PI + 360) % 360, card = 'sensul spre ' + ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-vest', 'vest', 'nord-vest'][Math.round(deg / 45) % 8];
  const C = { lat: 44.4268, lon: 26.1025 }, dA = E.haversine(a, C), dB = E.haversine(b, C), span = E.haversine(a, b);
  let out = card;
  if (dA < 10) { if (dB - dA < -0.5 * span) out = 'sensul spre centru'; else if (dB - dA > 0.5 * span) out = 'sensul dinspre centru'; }
  else if (dB - dA < -0.5 * span) out = 'sensul spre București';
  else if (/Bucure[șs]ti\s*[-–]\s*([A-ZĂÂÎȘȚ][^\s,]*)/.test(e.name || '') && dB - dA > 0.3 * span) out = 'sensul spre ' + (e.name.match(/Bucure[șs]ti\s*[-–]\s*([A-ZĂÂÎȘȚ][^\s,]*)/)[1]);
  else {
    let best = null;
    for (const p of NET.places || []) {
      if (!['city', 'town', 'village'].includes(p.kind)) continue;
      const n = NET.nodes[p.node]; if (!n) continue;
      const d = E.haversine(a, n); if (d < 3 || d > 30) continue;
      let da = Math.abs(Math.atan2((n.lon - a.lon) * kx, n.lat - a.lat) - brg) % (2 * Math.PI); if (da > Math.PI) da = 2 * Math.PI - da;
      if (da > 0.4) continue;
      const sc = da * 4 - d / 10 - (p.kind === 'city' || p.kind === 'town' ? 1.5 : 0); if (!best || sc < best.sc) best = { sc, name: p.name };
    }
    if (best) out = 'sensul spre ' + best.name;
  }
  DIRCACHE.set(eid, out); return out;
}
function createForecaster(o) {
  const E = o.E, NET = o.net, M = o.model, M0 = o.model0, version = o.version || '';
  const LR = () => (o.pack && o.pack.lr ? o.pack : null);
  const weatherFor = o.weatherFor || (() => 'senin');
  const CACHE = {}, PATHS = {};
  function slotEval(m, paths, date, t0, ctx, withQ, pk) {
    let best = null;
    for (const path of paths) { const w = m.walk(path, date, t0, ctx); if (!best || w.total < best.w.total) best = { path, w }; }
    if (!best) return null;
    const { path, w } = best, L = LR(), eb = Math.exp(E.pathShift(L && L.lr, w.parts, date)) * (pk ? pk(t0) : 1);   // pk: corecția din drumurile proprii, pe același traseu și la aceeași oră
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
  function forecast(h, date, light, dry) {
    const key = (light ? 'L|' : '') + (dry ? 'D|' : '') + h.id + '|' + h.o + h.d + '|' + date + '|' + h.ta + '|' + h.usual + '|' + version;
    if (CACHE[key]) return CACHE[key];
    const ctx = E.ctxFor(date, dry ? 'senin' : weatherFor(date, parseT(h.usual)), false), ctx0 = E.ctxFor(date, 'senin', false), ta = parseT(h.ta), usual = parseT(h.usual), deadline = ta - (o.bufferMin || 0); // ora aleasă de utilizator, fără rezerve ascunse
    const from = Math.min(usual - 60, ta - 150), to = Math.max(usual + 60, ta + 30), slots = [];
    const paths = pathsFor(h.o, h.d, date, usual, ctx); if (!paths.length) return (CACHE[key] = null);
    const pk = o.personal ? t => o.personal(h, date, t).f : null;   // și în varianta „vreme bună”, ca diferența să rămână doar efectul vremii
    for (let t = Math.round(from / 10) * 10; t <= to; t += 10) { const s = slotEval(M, paths, date, t, ctx, !light, pk); if (s) slots.push(s); }
    if (!slots.length) return (CACHE[key] = null);
    const pOn = s => { if (!s || !s.samp) return; let k = 0; for (const x of s.samp) if (s.t0 + x <= deadline) k++; s.pOn = k / s.samp.length; s.samp = null; };
  slots.forEach(pOn);
  const near = t => slots.reduce((a, b) => Math.abs(b.t0 - t) < Math.abs(a.t0 - t) ? b : a);
    const cur = slotEval(M, paths, date, usual, ctx, !light, pk), typ = slotEval(M0, paths, date, usual, ctx0, false);
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
      const dir = dirName(E, NET, r.segId);
      causes.push(m ? `${KIND_TXT[m[1]] || 'o problemă'}${road ? ' pe ' + road : ''}, ${dir} (semnalare de la participanți)` : (r.note || ('o bandă închisă' + (road ? ' pe ' + road : ''))) + (m ? '' : ', ' + dir));
    }
    const wx = !dry && o.weatherSpan ? o.weatherSpan(date, Math.min(usual, early ? early.t0 : usual) - 30, ta) : null;
    const res = { date, slots, cur, typ, early, calm, lateBy, extra, level, jam, causes: [...new Set(causes)], ta, usual, deadline, near, wx, wxDelta: 0, personal: o.personal ? o.personal(h, date, usual) : null };
    if (!dry && ctx.weather !== 'senin') {
      /* Vremea NU decide singură prin marja de siguranță de 95–97% (prognoza de ceață/ploaie e adesea greșită, iar
         marja ar amplifica efectul). Decizia se ia ca pe vreme bună, apoi se pleacă mai devreme cu exact minutele
         pe care vremea le adaugă în medie la drum, doar dacă sunt cel puțin 5. */
      const f0 = forecast(h, date, light, true);
      if (f0) {
        const d = Math.max(0, Math.round(cur.med - f0.cur.med)); res.wxDelta = d;
        res.lateBy = f0.lateBy; res.extra = f0.extra; res.jam = f0.jam;
        const base = f0.level === 'g' ? usual : (f0.early ? f0.early.t0 : f0.slots[0].t0), t = d >= 5 ? base - Math.max(5, Math.round(d / 5) * 5) : base;
        res.level = f0.level !== 'g' ? (f0.level === 'y' && d >= 20 ? 'r' : f0.level) : d >= 20 ? 'r' : t < usual ? 'y' : 'g';
        res.wxOnly = f0.level === 'g' && res.level !== 'g';
        res.early = t === base ? f0.early : Object.assign({}, near(t), { t0: t });
      }
    }
    if (wx) res.causes.push('vremea: ' + wx.txt);
    return (CACHE[key] = res);
  }
  const LV = { g: ['Drum liniștit', '🟢'], y: ['Aglomerat', '🟡'], r: ['Ambuteiaj anunțat', '🔴'] };
const KIND_TXT = { banda: 'o bandă închisă', lucrari: 'lucrări', accident: 'un accident', coada: 'o coadă', pericol: 'un obstacol pe carosabil', politie: 'un control al poliției' };
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
  const wx = f.wx ? ` Atenție la vreme: ${f.wx.txt}${f.wxDelta >= 3 ? `; drumul poate dura cu ~${f.wxDelta} min mai mult` : ''}.` : '';
  return {
    leave, level: f.level,
    morning: { title: `${h.name}: plecați la ${fmt(leave)}`, body: f.wxOnly ? `Drumul e liber, dar vremea îl poate lungi.${wx}` : (f.level === 'g' ? 'Drum liniștit, puteți pleca la ora obișnuită.' : `${f.level === 'r' ? 'Ambuteiaj' : 'Aglomerație'} pe drumul dumneavoastră.${where}${unusual}`) + wx },
    evening: { title: `Mâine: ${f.wxOnly ? 'vreme dificilă' : LV[f.level][0].toLowerCase()} · ${h.name.toLowerCase()}`, body: (f.level === 'g' ? `Puteți pleca la ora obișnuită, ${h.usual}.` : `Plecați la ${fmt(leave)} în loc de ${h.usual}.`) + `${where}${unusual}${wx}` }
  };
}

/* număr + „minut/minute/de minute” corect în română */
const minTxt = n => { n = Math.round(n); return n === 1 ? '1 minut' : (n % 100 === 0 || n % 100 >= 20) ? `${n} de minute` : `${n} minute`; };
/* Avertizare GRAVĂ (cu voce): doar dacă întârzierea la ora obișnuită de plecare e evidentă ȘI are o cauză clară
   (restricție / accident semnalat) sau o încetinire măsurată de cel puțin 15% pe drumul principal. */
function urgent(f, h, live) {
  if (!f) return null;
  const lv = live || { extra: 0 }, ta = f.ta, usual = f.usual;
  const typ = f.typ ? f.typ.med : f.cur.med, med = f.cur.med + (lv.extra || 0), late = usual + med - ta;
  const growth = (med - typ) / typ;
  const restr = f.causes.some(c => !c.startsWith('vremea')) && (f.extra >= 5 || growth >= 0.1), slow = ((lv.drop || 0) >= 0.15 && (lv.extra || 0) >= 3) || (lv.extra || 0) >= Math.max(5, 0.15 * typ);
  if (!(late >= 5 && (restr || slow))) return null;
  const leave = Math.floor((usual - late - 5) / 5) * 5;
  let cause = '';
  if (restr) cause = ` Cauza: ${f.causes.find(c => !c.startsWith('vremea'))}.`;
  else if (lv.road) cause = ` Viteza pe ${lv.road} a scăzut cu aproximativ ${Math.round((lv.drop || 0) * 100)}%.`;
  const text = `Dacă plecați la ora stabilită, ${fmt(usual)}, ajungeți cu aproximativ ${minTxt(late)} întârziere! Plecați la ${fmt(leave)}.${cause}`;
  return { late, leave, text, title: `⚠️ Ambuteiaj grav pe drumul dumneavoastră (${h.name.toLowerCase()})` };
}
const api = { dirName, wxCode, wxSpan, wxAt, WX_SEV, WX_ICON, createForecaster, decision, urgent, minTxt, LV, slotColor, fmt, parseT };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PLT = api;
})(typeof self !== 'undefined' ? self : this);
