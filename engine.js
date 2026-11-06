'use strict';
const E = {};
/* ---------- Utilitare numerice ---------- */
E.rng = function (seed) { // mulberry32 – reproductibil
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
E.normal = function (r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
E.hash = function (s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); };
E.quantile = function (sorted, p) { // cuantilă empirică (interpolare liniară)
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
};
E.median = a => E.quantile([...a].sort((x, y) => x - y), 0.5);
E.Phi = function (z) { // CDF normală standard
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
};
E.lnGamma = function (z) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - E.lnGamma(1 - z);
  z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};
E.binomUpperTail = function (x, n, p) { // P(X >= x), X ~ Bin(n,p)
  if (x <= 0) return 1; if (x > n) return 0;
  if (p <= 0) return 0; if (p >= 1) return 1;
  const lnC = (k) => E.lnGamma(n + 1) - E.lnGamma(k + 1) - E.lnGamma(n - k + 1);
  let s = 0; for (let k = x; k <= n; k++) s += Math.exp(lnC(k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  return Math.min(1, s);
};
/* Limita inferioară Clopper–Pearson unilaterală, nivel 1-alpha */
E.cpLower = function (x, n, alpha = 0.05) {
  if (n === 0 || x === 0) return 0;
  if (x === n) return Math.pow(alpha, 1 / n);
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (E.binomUpperTail(x, n, m) < alpha) lo = m; else hi = m; }
  return (lo + hi) / 2;
};
E.wilson = function (x, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = x / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
};
/* Nr. minim de deplasări pentru a demonstra punctualitate >= p0 (CP, 1-alpha), cu f eșecuri */
E.nRequired = function (p0 = 0.95, f = 0, alpha = 0.05) {
  for (let n = f + 1; n <= 5000; n++) if (E.cpLower(n - f, n, alpha) >= p0) return n;
  return Infinity;
};

/* ---------- Calendar România ---------- */
E.dayIndex = d => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
E.dateFromIndex = i => new Date(i * 86400000).toISOString().slice(0, 10);
E.orthodoxEaster = function (y) { // Meeus (calendar iulian) + 13 zile (valabil 1900–2099)
  const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  return E.dateFromIndex(E.dayIndex(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) + 13);
};
E._hol = {};
E.holidays = function (y) {
  if (E._hol[y]) return E._hol[y];
  const f = ['01-01', '01-02', '01-06', '01-07', '01-24', '05-01', '06-01', '08-15', '11-30', '12-01', '12-25', '12-26'].map(s => `${y}-${s}`);
  const ei = E.dayIndex(E.orthodoxEaster(y));
  [-2, 0, 1, 49, 50].forEach(k => f.push(E.dateFromIndex(ei + k))); // Vinerea Mare, Paști, Rusalii
  return (E._hol[y] = new Set(f));
};
E.dayType = function (date) { // L = luni–joi, V = vineri, S = sâmbătă, D = duminică/sărbătoare
  if (E.holidays(+date.slice(0, 4)).has(date)) return 'D';
  const w = new Date(date + 'T12:00:00Z').getUTCDay();
  return w === 0 ? 'D' : w === 6 ? 'S' : w === 5 ? 'V' : 'L';
};
E.dayClass = date => (['L', 'V'].includes(E.dayType(date)) ? 'lucr' : 'lib');

/* =====================================================================
   Motor predictiv mobilitate – București + Ilfov (pilot regional)
   Motor 0.3.0 – graf orientat, orice origine/destinație, 0 apeluri externe.
   ===================================================================== */
E.VERSION = '0.3.0';
E.CENTER = { lat: 44.4355, lon: 26.1025 }; // Universitate – referința pentru orientarea radială

/* ---------- Clase de drum (valori a priori, de calibrat) ---------- */
E.CLS = {
  A: { label: 'autostradă', lanes: 2, capLane: 1900, v0: 100, alpha: 0.5, beta: 4, base: 0.60 },
  C: { label: 'Centura (DNCB)', lanes: 2, capLane: 1500, v0: 60, alpha: 0.8, beta: 4, base: 0.68 },
  N: { label: 'drum național / penetrație', lanes: 2, capLane: 1500, v0: 60, alpha: 0.8, beta: 4, base: 0.66 },
  J: { label: 'drum județean / local', lanes: 1, capLane: 950, v0: 50, alpha: 0.9, beta: 4, base: 0.62 },
  M: { label: 'bulevard principal (semaforizat)', lanes: 3, capLane: 850, v0: 45, alpha: 1.2, beta: 4, base: 0.72 },
  B: { label: 'bulevard / stradă colectoare', lanes: 2, capLane: 800, v0: 40, alpha: 1.3, beta: 4, base: 0.70 }
};

/* ---------- Rețeaua-schelet București–Ilfov (schematică; înlocuibilă cu graph.json din OSM) ---------- */
E.SKELETON = {
  nodes: [
    ['UNI', 'Universitate', 44.4355, 26.1025, 'B'], ['UNR', 'Piața Unirii', 44.4268, 26.1025, 'B'], ['ROM', 'Piața Romană', 44.4466, 26.0975, 'B'],
    ['VIC', 'Piața Victoriei', 44.4520, 26.0855, 'B'], ['ARC', 'Arcul de Triumf', 44.4672, 26.0780, 'B'], ['CDG', 'Piața Charles de Gaulle', 44.4649, 26.0844, 'B'],
    ['PPL', 'Piața Presei Libere', 44.4874, 26.0750, 'B'], ['BAN', 'Băneasa', 44.4990, 26.0820, 'B'], ['AVI', 'Aviației / Barbu Văcărescu', 44.4800, 26.1050, 'B'],
    ['PIP', 'Pipera', 44.5050, 26.1300, 'B'], ['OBO', 'Obor', 44.4500, 26.1260, 'B'], ['COL', 'Colentina (Doamna Ghica)', 44.4600, 26.1430, 'B'],
    ['IAN', 'Piața Iancului', 44.4405, 26.1330, 'B'], ['DEL', 'Pantelimon (Delfinului)', 44.4490, 26.1540, 'B'], ['MUN', 'Piața Muncii', 44.4317, 26.1395, 'B'],
    ['DRI', 'Dristor', 44.4210, 26.1440, 'B'], ['TIT', 'Titan', 44.4230, 26.1700, 'B'], ['ALB', 'Piața Alba Iulia', 44.4290, 26.1240, 'B'],
    ['VIT', 'Vitan', 44.4180, 26.1250, 'B'], ['SUD', 'Piața Sudului', 44.3955, 26.1222, 'B'], ['BER', 'Berceni (Apărătorii Patriei)', 44.3790, 26.1150, 'B'],
    ['ERV', 'Eroii Revoluției', 44.4100, 26.0980, 'B'], ['PRO', 'Piața Progresului', 44.3860, 26.0890, 'B'], ['RAH', 'Rahova (Sebastian)', 44.4150, 26.0730, 'B'],
    ['GHE', 'Ghencea', 44.4120, 26.0450, 'B'], ['RAZ', 'Răzoare', 44.4210, 26.0600, 'B'], ['EROI', 'Eroilor', 44.4355, 26.0745, 'B'],
    ['UPB', 'POLITEHNICA (Grozăvești)', 44.4385, 26.0490, 'B'], ['LUJ', 'Lujerului', 44.4337, 26.0347, 'B'], ['MIL', 'Militari (Gorjului)', 44.4350, 26.0110, 'B'],
    ['DRT', 'Drumul Taberei', 44.4200, 26.0300, 'B'], ['GNO', 'Gara de Nord', 44.4465, 26.0735, 'B'], ['GRA', 'Podul Grant / Crângași', 44.4510, 26.0480, 'B'],
    ['CHB', 'Bucureștii Noi (Chibrit)', 44.4690, 26.0510, 'B'], ['BNO', 'Bucureștii Noi (nord)', 44.4880, 26.0380, 'B'],
    ['OTO', 'Otopeni', 44.5520, 26.0730, 'IF'], ['COR', 'Corbeanca', 44.5960, 26.0390, 'IF'], ['BAL', 'Balotești', 44.6130, 26.0940, 'IF'],
    ['TUN', 'Tunari', 44.5490, 26.1390, 'IF'], ['VOL', 'Voluntari', 44.4930, 26.1760, 'IF'], ['AFU', 'Afumați', 44.5260, 26.2440, 'IF'],
    ['PNT', 'Pantelimon (oraș)', 44.4520, 26.2050, 'IF'], ['CER', 'Cernica', 44.4190, 26.2780, 'IF'], ['POP', 'Popești-Leordeni', 44.3790, 26.1710, 'IF'],
    ['BRI', 'Berceni (Ilfov)', 44.3150, 26.1150, 'IF'], ['JIL', 'Jilava', 44.3330, 26.0780, 'IF'], ['MAG', 'Măgurele', 44.3500, 26.0300, 'IF'],
    ['BRG', 'Bragadiru', 44.3720, 25.9770, 'IF'], ['DOM', 'Domnești', 44.3970, 25.9150, 'IF'], ['CHJ', 'Chiajna', 44.4600, 25.9750, 'IF'],
    ['CHT', 'Chitila', 44.5080, 25.9820, 'IF'], ['BUF', 'Buftea', 44.5610, 25.9480, 'IF'], ['MOG', 'Mogoșoaia', 44.5290, 25.9960, 'IF'],
    ['cPOD', 'Centura – Pod Otopeni (DN1)', 44.5230, 26.0800, 'C'], ['cTUN', 'Centura – Tunari', 44.5320, 26.1330, 'C'], ['cA3', 'Centura – A3 Ștefănești', 44.5270, 26.1720, 'C'],
    ['cDN2', 'Centura – DN2 Afumați', 44.5070, 26.2120, 'C'], ['cDN3', 'Centura – DN3 Pantelimon', 44.4470, 26.2220, 'C'], ['cA2', 'Centura – A2', 44.4110, 26.2260, 'C'],
    ['cDN4', 'Centura – DN4 Popești', 44.3560, 26.1680, 'C'], ['cDN5', 'Centura – DN5 Jilava', 44.3430, 26.0920, 'C'], ['cDN6', 'Centura – DN6 Bragadiru', 44.3680, 25.9920, 'C'],
    ['cA1', 'Centura – A1 Chiajna', 44.4300, 25.9660, 'C'], ['cDN7', 'Centura – DN7', 44.4560, 25.9580, 'C'], ['cD1A', 'Centura – DN1A', 44.5150, 26.0060, 'C']
  ],
  /* [a, b, clasă, denumire, {suprascrieri}] – fiecare legătură generează două muchii orientate */
  links: [
    ['cPOD', 'cTUN', 'C', 'Centura nord'], ['cTUN', 'cA3', 'C', 'Centura nord'], ['cA3', 'cDN2', 'C', 'Centura nord-est'], ['cDN2', 'cDN3', 'C', 'Centura est'],
    ['cDN3', 'cA2', 'C', 'Centura est'], ['cA2', 'cDN4', 'C', 'Centura sud-est'], ['cDN4', 'cDN5', 'C', 'Centura sud'], ['cDN5', 'cDN6', 'C', 'Centura sud-vest'],
    ['cDN6', 'cA1', 'C', 'Centura vest'], ['cA1', 'cDN7', 'C', 'Centura vest'], ['cDN7', 'cD1A', 'C', 'Centura nord-vest'], ['cD1A', 'cPOD', 'C', 'Centura nord'],
    ['COR', 'OTO', 'J', 'DJ Corbeanca–Otopeni'], ['BAL', 'OTO', 'N', 'DN1 Balotești–Otopeni'],
    ['OTO', 'cPOD', 'N', 'DN1 Otopeni → Pod Otopeni', { lanes: 3, capLane: 1800, len: 3.0, ab: { am: 0.90, bottleneck: true } }],
    ['cPOD', 'BAN', 'N', 'DN1 Pod Otopeni → Băneasa', { lanes: 3, capLane: 1800, len: 4.5 }],
    ['BAN', 'PPL', 'M', 'Șos. București–Ploiești'], ['PPL', 'ARC', 'M', 'Șos. Kiseleff'], ['ARC', 'VIC', 'M', 'Șos. Kiseleff'],
    ['ARC', 'CDG', 'B', 'Bd. Constantin Prezan'], ['CDG', 'VIC', 'B', 'Bd. Aviatorilor'], ['CDG', 'ROM', 'B', 'Calea Dorobanți'],
    ['COR', 'MOG', 'J', 'Corbeanca–Mogoșoaia (schematic)'], ['BUF', 'MOG', 'N', 'DN1A Buftea–Mogoșoaia'], ['MOG', 'cD1A', 'N', 'DN1A'],
    ['cD1A', 'BNO', 'N', 'DN1A → Bucureștii Noi', { ab: { bottleneck: true } }], ['CHT', 'cD1A', 'J', 'Chitila – Centura'], ['CHT', 'BNO', 'J', 'Chitila → Bucureștii Noi'],
    ['BNO', 'CHB', 'M', 'Bd. Bucureștii Noi'], ['CHB', 'GRA', 'M', 'Bd. Bucureștii Noi → Podul Grant'], ['CHB', 'PPL', 'B', 'Bd. Expoziției / Ion Mihalache'],
    ['GRA', 'GNO', 'B', 'Calea Griviței'], ['GNO', 'VIC', 'B', 'Gara de Nord → Victoriei'], ['GRA', 'UPB', 'M', 'Podul Grant → Grozăvești'],
    ['UPB', 'EROI', 'M', 'Splaiul Independenței'], ['EROI', 'UNI', 'M', 'Bd. M. Kogălniceanu'], ['GNO', 'EROI', 'B', 'Bd. Berzei'],
    ['UPB', 'LUJ', 'M', 'Bd. Iuliu Maniu'], ['LUJ', 'MIL', 'M', 'Bd. Iuliu Maniu'], ['MIL', 'cA1', 'N', 'Bd. Iuliu Maniu → A1', { ba: { bottleneck: true } }],
    ['CHJ', 'MIL', 'J', 'Chiajna → Militari', { ab: { bottleneck: true } }], ['CHJ', 'cDN7', 'J', 'Chiajna – Centura'], ['cDN7', 'GRA', 'N', 'DN7 → Calea Giulești'],
    ['DOM', 'cA1', 'J', 'Domnești – Centura'], ['DOM', 'GHE', 'J', 'Prelungirea Ghencea', { ab: { bottleneck: true } }], ['GHE', 'RAZ', 'B', 'Bd. Ghencea'],
    ['DRT', 'RAZ', 'B', 'Bd. Drumul Taberei'], ['DRT', 'LUJ', 'B', 'Drumul Taberei → Lujerului'], ['RAZ', 'EROI', 'B', 'Șos. Panduri / Bd. Geniului'],
    ['RAZ', 'RAH', 'B', 'Calea 13 Septembrie'], ['RAH', 'ERV', 'B', 'Calea Rahovei'], ['BRG', 'cDN6', 'N', 'DN6 Bragadiru'],
    ['cDN6', 'RAH', 'N', 'DN6 Șos. Alexandriei', { ab: { bottleneck: true } }], ['MAG', 'PRO', 'J', 'Șos. Măgurele', { ab: { bottleneck: true } }], ['MAG', 'cDN5', 'J', 'Măgurele – Jilava'],
    ['JIL', 'cDN5', 'N', 'DN5 Jilava'], ['cDN5', 'PRO', 'N', 'DN5 Șos. Giurgiului', { ab: { bottleneck: true } }], ['PRO', 'ERV', 'M', 'Șos. Giurgiului'],
    ['ERV', 'UNR', 'M', 'Calea Șerban Vodă'], ['BRI', 'cDN4', 'J', 'Berceni (IF) – Centura'], ['BRI', 'BER', 'J', 'Berceni (IF) → Apărătorii Patriei'],
    ['BER', 'SUD', 'M', 'Bd. Berceni'], ['SUD', 'UNR', 'M', 'Șos. Olteniței – Bd. D. Cantemir'], ['POP', 'cDN4', 'N', 'DN4 Popești-Leordeni'],
    ['cDN4', 'SUD', 'N', 'DN4 Șos. Olteniței', { ab: { bottleneck: true } }], ['VIT', 'UNR', 'B', 'Calea Vitan'], ['VIT', 'DRI', 'B', 'Calea Vitan – Dristor'],
    ['cA2', 'TIT', 'N', 'A2 → Bd. Theodor Pallady', { lanes: 3, ab: { bottleneck: true } }], ['CER', 'cA2', 'J', 'Cernica – Centura'], ['TIT', 'DRI', 'B', 'Bd. 1 Decembrie 1918'],
    ['TIT', 'MUN', 'M', 'Bd. Basarabia'], ['DRI', 'MUN', 'M', 'Bd. Camil Ressu'], ['MUN', 'ALB', 'M', 'Calea Călărașilor'], ['ALB', 'UNR', 'M', 'Bd. Unirii'],
    ['PNT', 'cDN3', 'J', 'Pantelimon (oraș) – Centura'], ['cDN3', 'DEL', 'N', 'DN3 Șos. Pantelimon', { ab: { bottleneck: true } }], ['DEL', 'IAN', 'M', 'Șos. Pantelimon'],
    ['IAN', 'MUN', 'B', 'Bd. Ferdinand'], ['IAN', 'OBO', 'B', 'Șos. Mihai Bravu'], ['IAN', 'UNI', 'M', 'Bd. Pache Protopopescu – Carol I'],
    ['AFU', 'cDN2', 'N', 'DN2 Afumați'], ['cDN2', 'VOL', 'N', 'DN2 → Voluntari'], ['VOL', 'COL', 'M', 'Șos. Colentina', { ab: { bottleneck: true } }],
    ['COL', 'OBO', 'M', 'Șos. Colentina'], ['OBO', 'ROM', 'M', 'Bd. Dacia'], ['OBO', 'VIC', 'M', 'Bd. Ștefan cel Mare'],
    ['cA3', 'PIP', 'N', 'A3 → Pipera'], ['VOL', 'PIP', 'J', 'Voluntari → Pipera', { ab: { bottleneck: true } }], ['PIP', 'AVI', 'M', 'Bd. Dimitrie Pompeiu – Barbu Văcărescu', { ab: { bottleneck: true } }],
    ['AVI', 'CDG', 'B', 'Calea Floreasca'], ['cTUN', 'PIP', 'J', 'Șos. Pipera–Tunari'], ['TUN', 'cTUN', 'J', 'Tunari – Centura'], ['TUN', 'OTO', 'J', 'Tunari – Otopeni'],
    ['BAN', 'AVI', 'B', 'Bd. Ion Ionescu de la Brad'], ['ROM', 'UNI', 'M', 'Bd. Magheru – Bălcescu'], ['VIC', 'ROM', 'M', 'Bd. Lascăr Catargiu'], ['UNI', 'UNR', 'M', 'Bd. I.C. Brătianu']
  ]
};

E.haversine = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
/* cos între direcția muchiei și direcția spre centru: +1 = spre centru, −1 = dinspre centru */
E.radialCos = (a, b) => {
  const kx = Math.cos(E.CENTER.lat * Math.PI / 180);
  const dx = (b.lon - a.lon) * kx, dy = b.lat - a.lat, cx = (E.CENTER.lon - (a.lon + b.lon) / 2) * kx, cy = E.CENTER.lat - (a.lat + b.lat) / 2;
  const n1 = Math.hypot(dx, dy), n2 = Math.hypot(cx, cy); if (n1 < 1e-9 || n2 < 1e-6) return 0;
  return (dx * cx + dy * cy) / (n1 * n2);
};
/* atribute a priori ale unei muchii orientate – aceeași funcție e replicată în importatorul OSM */
E.edgeAttrs = function (cls, a, b, ov) {
  const c = E.CLS[cls], cos = E.radialCos(a, b), ov2 = ov || {};
  const cin = Math.max(0, cos), cout = Math.max(0, -cos);
  const e = {
    cls, lanes: ov2.lanes || c.lanes, capLane: ov2.capLane || c.capLane, v0: ov2.v0 || c.v0, alpha: c.alpha, beta: c.beta,
    len: ov2.len || Math.round(E.haversine(a, b) * 1.2 * 100) / 100,
    am: Math.min(0.95, Math.max(0.35, c.base + 0.25 * cin - 0.12 * cout)),
    pm: Math.min(0.95, Math.max(0.35, c.base + 0.22 * cout - 0.10 * cin)),
    bottleneck: false, radial: Math.round(cos * 100) / 100
  };
  return Object.assign(e, ov2.dir || {});
};
E.buildSkeleton = function () {
  const nodes = {}, edges = {};
  for (const [id, name, lat, lon, zone] of E.SKELETON.nodes) nodes[id] = { name, lat, lon, zone };
  for (const [a, b, cls, name, ov] of E.SKELETON.links) {
    const o = ov || {};
    edges[a + '>' + b] = Object.assign({ from: a, to: b, name }, E.edgeAttrs(cls, nodes[a], nodes[b], { lanes: o.lanes, capLane: o.capLane, len: o.len, dir: o.ab }));
    edges[b + '>' + a] = Object.assign({ from: b, to: a, name }, E.edgeAttrs(cls, nodes[b], nodes[a], { lanes: o.lanes, capLane: o.capLane, len: o.len, dir: o.ba }));
  }
  return { meta: { source: 'schelet schematic v0.3 (nu OSM)', nodes: Object.keys(nodes).length, edges: Object.keys(edges).length }, nodes, edges };
};
E.adjacency = function (net) { const adj = {}; for (const id in net.nodes) adj[id] = []; for (const [eid, e] of Object.entries(net.edges)) if (adj[e.from]) adj[e.from].push(eid); return adj; };
E.validateNet = function (net) {
  const err = [];
  if (!net || !net.nodes || !net.edges) return ['lipsesc nodes/edges'];
  for (const [eid, e] of Object.entries(net.edges)) {
    if (!net.nodes[e.from] || !net.nodes[e.to]) err.push(eid + ': nod inexistent');
    for (const k of ['len', 'lanes', 'capLane', 'v0', 'alpha', 'beta', 'am', 'pm']) if (!(typeof e[k] === 'number' && isFinite(e[k]) && e[k] > 0)) err.push(eid + ': ' + k + ' invalid');
    if (err.length > 20) break;
  }
  return err;
};

E.WEATHER = {
  senin: { label: 'Senin / uscat', cap: 1.00, speed: 1.00, sig: 0.00 },
  ploaie: { label: 'Ploaie', cap: 0.92, speed: 0.95, sig: 0.03 },
  torential: { label: 'Ploaie torențială', cap: 0.85, speed: 0.88, sig: 0.06 },
  ceata: { label: 'Ceață', cap: 0.90, speed: 0.85, sig: 0.05 },
  ninsoare: { label: 'Ninsoare / polei', cap: 0.78, speed: 0.75, sig: 0.10 }
};
E.PARAMS = { rho: 0.55, workZoneFactor: 0.90, kJam: 130, n0: 8, safetyUncal: Math.log(1.10), minCal: 19 };
E.ctxFor = (date, weather, vacation) => ({ dayType: E.dayType(date), weather: weather || 'senin', vacation: !!vacation });
E.period = t => { const h = ((t % 1440) + 1440) % 1440 / 60; return h < 6 ? 'noapte' : h < 10 ? 'am' : h < 15 ? 'zi' : h < 20 ? 'pm' : 'seara'; };
E.lenClass = km => (km < 10 ? 'sub 10 km' : km < 25 ? '10–25 km' : 'peste 25 km');

/* ---------- Modelul fizico-statistic pe graf ---------- */
class Model {
  constructor(net, restrictions, params) {
    this.net = net; this.seg = net.edges; this.restr = restrictions || []; this.p = Object.assign({}, E.PARAMS, params || {});
    this.adj = E.adjacency(net); this.qcache = new Map(); this.memo = new Map();
  }
  demandX(s, t, ctx) {
    const dt = ctx.dayType; let base = 0.33, ka = 1, kp = 1, kb = 1;
    if (dt === 'V') kp = 1.06;
    if (dt === 'S') { ka = 0.15; kp = 0.35; kb = 0.8; }
    if (dt === 'D') { ka = 0.05; kp = 0.30; kb = 0.6; }
    if (ctx.vacation) ka *= 0.8;
    const tt = ((t % 1440) + 1440) % 1440;
    const day = 1 / (1 + Math.exp(-(tt - 330) / 25)) / (1 + Math.exp((tt - 1290) / 40));
    const g = (mu, sd) => Math.exp(-0.5 * ((tt - mu) / sd) ** 2);
    return 0.06 + (base * kb - 0.06) * day + ka * Math.max(0, s.am - base) * g(470, 55) + kp * Math.max(0, s.pm - base) * g(1060, 75);
  }
  activeRestr(eid, absMin) {
    let closed = 0, open = false; const list = [];
    for (const r of this.restr) {
      if (r.segId !== eid || r.disabled) continue;
      const a = E.dayIndex(r.startDate) * 1440 + r.startMin, b = r.endDate ? E.dayIndex(r.endDate) * 1440 + r.endMin : Infinity;
      if (absMin >= a && absMin < b) { closed = Math.max(closed, r.closedLanes); if (!r.endDate) open = true; list.push(r); }
    }
    return { closed, open, list };
  }
  flowCap(eid, date, t, ctx) {
    const s = this.seg[eid], w = E.WEATHER[ctx.weather] || E.WEATHER.senin;
    const ar = this.activeRestr(eid, E.dayIndex(date) * 1440 + t);
    const lanesEff = Math.max(0.5, s.lanes - ar.closed);
    const C = lanesEff * s.capLane * (ar.closed > 0 ? this.p.workZoneFactor : 1) * w.cap;
    return { q: this.demandX(s, t, ctx) * s.lanes * s.capLane, C, ar };
  }
  queue(eid, date, ctx) {
    const s = this.seg[eid], di = E.dayIndex(date);
    let sig = '';
    for (const r of this.restr) if (r.segId === eid && !r.disabled && E.dayIndex(r.startDate) <= di + 1 && (!r.endDate || E.dayIndex(r.endDate) >= di)) sig += r.id + ',';
    if (!s.bottleneck && !sig) return null;
    const key = eid + '|' + date + '|' + ctx.weather + '|' + (ctx.vacation ? 1 : 0) + '|' + sig;
    let res = this.qcache.get(key); if (res) return res;
    const T0 = 240, T1 = 1500, delay = new Float32Array(T1 - T0 + 1), N = new Float32Array(T1 - T0 + 1);
    let n = 0;
    for (let t = T0; t <= T1; t++) { const { q, C } = this.flowCap(eid, date, t, ctx); n = Math.max(0, n + (q - C) / 60); N[t - T0] = n; delay[t - T0] = n / C * 60; }
    res = { T0, delay, N }; this.qcache.set(key, res); return res;
  }
  segState(eid, date, t, ctx) {
    t = Math.round(t);
    const key = eid + '|' + date + '|' + t + '|' + ctx.weather + (ctx.vacation ? 1 : 0);
    const m = this.memo.get(key); if (m) return m;
    const s = this.seg[eid], w = E.WEATHER[ctx.weather] || E.WEATHER.senin;
    const { q, C, ar } = this.flowCap(eid, date, t, ctx);
    const tff = s.len / (s.v0 * w.speed) * 60, xr = Math.min(q / C, 1.2);
    const bpr = tff * (1 + s.alpha * Math.pow(xr, s.beta));
    const Q = this.queue(eid, date, ctx);
    let delay = 0, Nq = 0;
    if (Q) { const i = Math.min(Math.max(t - Q.T0, 0), Q.delay.length - 1); delay = Q.delay[i]; Nq = Q.N[i]; }
    const med = bpr + delay;
    const sigma = 0.07 + 0.18 * Math.min(1, q / C) + (delay > 0 ? 0.30 * delay / med : 0) + (ar.open ? 0.08 : 0) + w.sig;
    const res = { med, sigma, tff, q, C, delay, Nq, qlenKm: Nq / (s.lanes * this.p.kJam), closed: ar.closed };
    if (this.memo.size > 400000) this.memo.clear();
    this.memo.set(key, res); return res;
  }
  /* parcurgere deterministă (mediane), cu propagarea orei de intrare */
  walk(path, date, t0, ctx) {
    let t = t0; const parts = [];
    for (const eid of path) { const st = this.segState(eid, date, t, ctx); parts.push({ eid, t, med: st.med }); t += st.med; }
    return { total: t - t0, parts };
  }
  simPath(path, date, t0, ctx, K, seed) {
    const r = E.rng(seed), rho = this.p.rho, sq = Math.sqrt(1 - rho * rho), out = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const zd = E.normal(r); let t = t0;
      for (const eid of path) { const st = this.segState(eid, date, t, ctx); t += st.med * Math.exp(st.sigma * (rho * zd + sq * E.normal(r))); }
      out[k] = t - t0;
    }
    return Array.from(out).sort((a, b) => a - b);
  }
  predictPath(path, date, t0, ctx, K = 500, tau = 0.95) {
    const seed = parseInt(E.hash(path.join(',') + '|' + date + '|' + t0 + '|' + ctx.weather + '|' + ctx.vacation), 16);
    const sm = this.simPath(path, date, t0, ctx, K, seed);
    return { samples: sm, median: E.quantile(sm, 0.5), q: E.quantile(sm, tau) };
  }
  /* Dijkstra dependent de timp (FIFO) pe medianele modelului; cost = timp × penalizare */
  route(o, d, date, t0, ctx, penalty) {
    const dist = { [o]: 0 }, prev = {}, done = new Set(), heap = [[0, o]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const tt = { [o]: 0 };
    while (heap.length) {
      const [c, u] = pop(); if (done.has(u)) continue; done.add(u); if (u === d) break;
      for (const eid of this.adj[u] || []) {
        const e = this.seg[eid], st = this.segState(eid, date, t0 + tt[u], ctx);
        const nc = c + st.med * (penalty && penalty[eid] ? penalty[eid] : 1);
        if (dist[e.to] === undefined || nc < dist[e.to]) { dist[e.to] = nc; tt[e.to] = tt[u] + st.med; prev[e.to] = eid; push([nc, e.to]); }
      }
    }
    if (!prev[d] && o !== d) return null;
    const path = []; let v = d; while (v !== o) { const eid = prev[v]; path.unshift(eid); v = this.seg[eid].from; }
    return path;
  }
  /* trasee alternative prin metoda penalizării (până la K, suprapunere < 75% în lungime) */
  alternatives(o, d, date, t0, ctx, K = 3) {
    const out = [], pen = {};
    for (let it = 0; it < K + 3 && out.length < K; it++) {
      const p = this.route(o, d, date, t0, ctx, pen); if (!p) break;
      const L = p.reduce((s, e) => s + this.seg[e].len, 0);
      const dup = out.some(q => { const set = new Set(q.path); return p.filter(e => set.has(e)).reduce((s, e) => s + this.seg[e].len, 0) / L > 0.75; });
      if (!dup) out.push({ path: p, len: L });
      for (const e of p) pen[e] = (pen[e] || 1) * 1.6;
    }
    return out.map((r, i) => Object.assign(r, { id: E.hash(r.path.join(',')).slice(0, 6), name: E.pathName(this.net, r.path), idx: i }));
  }
}
E.Model = Model;
E.pathName = function (net, path) {
  const names = []; for (const eid of path) { const n = net.edges[eid].name; if (names[names.length - 1] !== n) names.push(n); }
  return names.length > 4 ? [names[0], names[1], '…', names[names.length - 2], names[names.length - 1]].join(' → ') : names.join(' → ');
};
E.pathLen = (net, path) => path.reduce((s, e) => s + net.edges[e].len, 0);

/* ---------- Învățare pe muchii: backfitting ierarhic (muchie → muchie × clasă zi × perioadă) ---------- */
E.bkey = (eid, date, t) => eid + '|' + E.dayClass(date) + '|' + E.period(t);
E.learnEdges = function (rows, segObs, n0, iters = 3) {
  // rows: {trip, parts:[{eid,t,med}], prior: total median, obs}
  const L1 = {}, L2 = {}, W = {};
  const bOf = (eid, date, t) => (L1[eid] ? L1[eid].b : 0) + (L2[E.bkey(eid, date, t)] ? L2[E.bkey(eid, date, t)].b : 0);
  for (let it = 0; it < iters; it++) {
    for (const level of [1, 2]) {
      const acc = {};
      const add = (k, w, r) => { (acc[k] = acc[k] || { s: 0, w: 0 }); acc[k].s += w * r; acc[k].w += w; };
      for (const row of rows) {
        let tot = 0; const adj = row.parts.map(p => { const m = p.med * Math.exp(bOf(p.eid, row.trip.date, p.t)); tot += m; return m; });
        const r = Math.log(row.obs) - Math.log(tot);
        row.parts.forEach((p, i) => add(level === 1 ? p.eid : E.bkey(p.eid, row.trip.date, p.t), adj[i] / tot, r));
      }
      for (const o of segObs || []) { if (!o._med) continue; const r = Math.log(o.dur) - Math.log(o._med * Math.exp(bOf(o.segId, o.date, o.t))); add(level === 1 ? o.segId : E.bkey(o.segId, o.date, o.t), 1, r); }
      const T = level === 1 ? L1 : L2;
      for (const [k, a] of Object.entries(acc)) { (T[k] = T[k] || { b: 0, w: 0 }); T[k].b += a.s / (a.w + n0); T[k].w = a.w; }
    }
  }
  for (const [k, v] of Object.entries(L1)) W[k] = v.w;
  return { L1, L2, W, n0 };
};
E.edgeBias = (lr, eid, date, t) => lr ? (lr.L1[eid] ? lr.L1[eid].b : 0) + (lr.L2[E.bkey(eid, date, t)] ? lr.L2[E.bkey(eid, date, t)].b : 0) : 0;
/* deplasarea traseului pe scară log prin corecțiile muchiilor (ponderi = mediane) */
E.pathShift = function (lr, parts, date) {
  if (!lr) return 0; let a = 0, b = 0;
  for (const p of parts) { a += p.med; b += p.med * Math.exp(E.edgeBias(lr, p.eid, date, p.t)); }
  return Math.log(b / a);
};
/* sprijinul datelor: fracția din lungimea traseului pe muchii cu ≥ 10 observații efective */
E.support = function (lr, net, path) {
  if (!lr) return 0; let L = 0, Ls = 0;
  for (const e of path) { L += net.edges[e].len; if ((lr.W[e] || 0) >= 10) Ls += net.edges[e].len; }
  return L ? Ls / L : 0;
};
E.priorRows = function (model, trips, K, tau) {
  return trips.map(tr => {
    const ctx = E.ctxFor(tr.date, tr.weather, tr.vacation);
    const w = model.walk(tr.path, tr.date, tr.dep, ctx);
    const p = model.predictPath(tr.path, tr.date, tr.dep, ctx, K, tau);
    return { trip: tr, parts: w.parts, med: p.median, q: p.q, obs: tr.dur, km: E.pathLen(model.net, tr.path) };
  });
};
/* calibrare conformă Mondrian pe clase de lungime, cu revenire la setul agregat */
E.conformal = function (cal, lr, tau, minCal) {
  const score = r => Math.log(r.obs) - Math.log(r.q) - E.pathShift(lr, r.parts, r.trip.date);
  const one = (arr) => {
    const s = arr.map(score).sort((a, b) => a - b), n = s.length, k = Math.ceil((n + 1) * tau);
    if (n < minCal || k > n) return { calibrated: false, qhat: E.PARAMS.safetyUncal, n };
    let qhat = s[k - 1]; if (n < 40) qhat = Math.max(qhat, 0);
    return { calibrated: true, qhat, n };
  };
  const pooled = one(cal), byClass = {};
  for (const c of ['sub 10 km', '10–25 km', 'peste 25 km']) { const r = one(cal.filter(x => E.lenClass(x.km) === c)); byClass[c] = r.calibrated ? r : Object.assign({}, pooled, { fromPooled: true, nClass: r.n }); }
  return { pooled, byClass, calibrated: pooled.calibrated };
};
E.qhatFor = (conf, km) => (conf ? conf.byClass[E.lenClass(km)] : { calibrated: false, qhat: E.PARAMS.safetyUncal, n: 0 });
E.sortTrips = trips => [...trips].filter(t => t.dur > 0 && t.path && t.path.length).sort((a, b) => (E.dayIndex(a.date) * 1440 + a.dep) - (E.dayIndex(b.date) * 1440 + b.dep));
E.attachSegMed = function (model, segObs) { for (const o of segObs || []) if (model.seg[o.segId]) o._med = model.segState(o.segId, o.date, o.t, E.ctxFor(o.date, o.weather, false)).med; return (segObs || []).filter(o => o._med); };
E.train = function (model, trips, segObs, opts) {
  const o = Object.assign({ tau: 0.95, K: 150, calFrac: 0.25 }, opts || {});
  const tr = E.sortTrips(trips).filter(t => t.path.every(e => model.seg[e]));
  const rows = E.priorRows(model, tr, o.K, o.tau), nCal = Math.floor(rows.length * o.calFrac);
  const fit = rows.slice(0, rows.length - nCal), cal = rows.slice(rows.length - nCal);
  const so = E.attachSegMed(model, segObs);
  const lr = E.learnEdges(fit, so, model.p.n0);
  const conf = E.conformal(cal, lr, o.tau, model.p.minCal);
  const version = E.hash(JSON.stringify({ n: Object.keys(model.seg).length, s: model.net.meta, restr: model.restr.map(r => r.id), ids: tr.map(t => t.id), tau: o.tau, v: E.VERSION }));
  return { lr, conf, tau: o.tau, nFit: fit.length, nCal: cal.length, version, trainedOn: tr.length };
};

/* ---------- Recomandare pentru orice O/D ---------- */
E.recommend = function (model, learned, q) {
  const { o, d, date, ta, buffer = 5, window = 180, step = 5, K = 400 } = q;
  const tau = learned ? learned.tau : 0.95, ctx = E.ctxFor(date, q.weather, q.vacation), deadline = ta - buffer;
  const lr = learned ? learned.lr : null;
  // alternativele se caută la o oră de plecare reprezentativă (≈ termen − 1,3 × durata liberă estimată)
  const probe = model.route(o, d, date, deadline - 60, ctx);
  if (!probe) return { error: 'Nu există drum între origine și destinație în rețeaua curentă.' };
  const tProbe = Math.round(deadline - 1.2 * model.walk(probe, date, deadline - 60, ctx).total);
  const alts = model.alternatives(o, d, date, tProbe, ctx, 3);
  const per = alts.map(alt => {
    const conf = E.qhatFor(learned && learned.conf, alt.len), curve = [];
    for (let t0 = ta - window; t0 <= deadline - 5; t0 += step) {
      const w = model.walk(alt.path, date, t0, ctx), p = model.predictPath(alt.path, date, t0, ctx, K, tau);
      const eb = Math.exp(E.pathShift(lr, w.parts, date)), qc = p.q * eb * Math.exp(conf.qhat), avail = deadline - t0;
      let ok = 0; for (const x of p.samples) if (x * eb <= avail) ok++;
      curve.push({ t0, med: p.median * eb, qModel: p.q * eb, qc, pModel: ok / p.samples.length, feasible: t0 + qc <= deadline });
    }
    const feas = curve.filter(c => c.feasible);
    return { route: alt, curve, best: feas.length ? feas[feas.length - 1] : null, conf, support: E.support(lr, model.net, alt.path) };
  });
  const cands = per.filter(p => p.best).sort((a, b) => (b.best.t0 - a.best.t0) || (a.best.med - b.best.med));
  const best = cands.length ? Object.assign({ route: cands[0].route, conf: cands[0].conf, support: cands[0].support }, cands[0].best) : null;
  let fallback = null;
  if (!best) for (const p of per) for (const c of p.curve) if (!fallback || c.pModel > fallback.pModel || (c.pModel === fallback.pModel && c.t0 < fallback.t0)) fallback = Object.assign({ route: p.route }, c);
  return { per, best, fallback, ctx, tau };
};

E.congestionForecast = function (model, date, tNow, ctx, segIds, horizon = 60, step = 10, factor = 2.5) {
  return segIds.map(sid => {
    const cells = [];
    for (let h = 0; h <= horizon; h += step) { const st = model.segState(sid, date, tNow + h, ctx); cells.push({ h, p: 1 - E.Phi((Math.log(factor * st.tff) - Math.log(st.med)) / st.sigma), med: st.med, qlen: st.qlenKm }); }
    return { sid, cells };
  });
};
E.pSevere = (st, factor = 2.5) => 1 - E.Phi((Math.log(factor * st.tff) - Math.log(st.med)) / st.sigma);

/* ---------- URRD ---------- */
E.cusum = function (model, obs, ctxOf, k = 0.5, h = 3.0) {
  let S = 0; return obs.map(o => { const st = model.segState(o.segId, o.date, o.t, ctxOf(o)); const z = (Math.log(o.dur) - Math.log(st.med)) / st.sigma; S = Math.max(0, S + z - k); return Object.assign({}, o, { z, S, expected: st.med, alarm: S > h || z > h }); });
};
E.invertRestriction = function (net, baseRestr, obs, ctxOf) {
  if (!obs.length) return null;
  const o0 = obs[0], last = obs[obs.length - 1], s = net.edges[o0.segId]; let best = null;
  for (let closed = 1; closed < Math.max(2, s.lanes); closed++) for (let start = last.t - 240; start <= last.t; start += 10) {
    if (start < 240) continue;
    const m = new Model(net, baseRestr.concat([{ id: 'hyp', segId: o0.segId, closedLanes: Math.min(closed, s.lanes - 0.5), startDate: o0.date, startMin: start, endDate: null, endMin: 0 }]));
    let err = 0; for (const o of obs) { const st = m.segState(o.segId, o.date, o.t, ctxOf(o)); err += (Math.log(o.dur) - Math.log(st.med)) ** 2; }
    if (!best || err < best.err) best = { closed, start, err, rmsLog: Math.sqrt(err / obs.length) };
  }
  return best;
};

/* ---------- Evaluare ---------- */
E.metrics = function (rows) {
  const n = rows.length; if (!n) return null;
  const ae = rows.map(r => Math.abs(r.obs - r.med)).sort((a, b) => a - b), cov = rows.filter(r => r.obs <= r.q).length, tau = rows[0].tau;
  const pin = rows.reduce((s, r) => { const u = r.obs - r.q; return s + Math.max(tau * u, (tau - 1) * u); }, 0) / n;
  return { n, medAE: E.quantile(ae, 0.5), meanAE: ae.reduce((a, b) => a + b, 0) / n, cov, covRate: cov / n, wilson: E.wilson(cov, n), cpLow: E.cpLower(cov, n), pinball: pin };
};
E.backtest = function (model, trips, segObs, opts) {
  const o = Object.assign({ tau: 0.95, K: 150 }, opts || {});
  const tr = E.sortTrips(trips).filter(t => t.path.every(e => model.seg[e]));
  if (tr.length < 30) return { error: 'Sunt necesare cel puțin 30 de deplasări pentru backtest (60% ajustare / 20% calibrare / 20% test).' };
  const rows = E.priorRows(model, tr, o.K, o.tau), n = rows.length, i1 = Math.floor(n * 0.6), i2 = Math.floor(n * 0.8);
  const fit = rows.slice(0, i1), cal = rows.slice(i1, i2), test = rows.slice(i2);
  const tEnd = E.dayIndex(fit[fit.length - 1].trip.date) * 1440 + fit[fit.length - 1].trip.dep;
  const so = E.attachSegMed(model, segObs).filter(x => E.dayIndex(x.date) * 1440 + x.t <= tEnd);
  const lr = E.learnEdges(fit, so, model.p.n0), conf = E.conformal(cal, lr, o.tau, model.p.minCal);
  const mk = (r, med, q) => ({ obs: r.obs, med, q, tau: o.tau, r });
  const grp = {}; fit.concat(cal).forEach(r => { const k = r.trip.orig + '>' + r.trip.dest + '|' + E.period(r.trip.dep); (grp[k] = grp[k] || []).push(r.obs); });
  const sets = {
    'Referință (istoric O/D × perioadă)': test.map(r => { const a = grp[r.trip.orig + '>' + r.trip.dest + '|' + E.period(r.trip.dep)]; if (!a || a.length < 5) return mk(r, r.med, r.q); const s = [...a].sort((x, y) => x - y); return mk(r, E.quantile(s, 0.5), E.quantile(s, o.tau)); }),
    'Model fizic a priori': test.map(r => mk(r, r.med, r.q)),
    '+ corecții învățate pe muchii': test.map(r => { const eb = Math.exp(E.pathShift(lr, r.parts, r.trip.date)); return mk(r, r.med * eb, r.q * eb); }),
    '+ calibrare conformă Mondrian (final)': test.map(r => { const eb = Math.exp(E.pathShift(lr, r.parts, r.trip.date)); return mk(r, r.med * eb, r.q * eb * Math.exp(E.qhatFor(conf, r.km).qhat)); })
  };
  const models = {}; for (const [k, v] of Object.entries(sets)) models[k] = E.metrics(v);
  // acoperire pe clase de lungime și pe zona de origine (modelul final)
  const fin = sets['+ calibrare conformă Mondrian (final)'], strata = {};
  for (const x of fin) { for (const key of ['Lungime: ' + E.lenClass(x.r.km), 'Origine: ' + (model.net.nodes[x.r.trip.orig] ? (model.net.nodes[x.r.trip.orig].zone === 'B' ? 'București' : 'Ilfov') : '?')]) (strata[key] = strata[key] || []).push(x); }
  const strat = Object.entries(strata).map(([k, v]) => Object.assign({ k }, E.metrics(v))).sort((a, b) => a.k.localeCompare(b.k));
  return { nFit: fit.length, nCal: cal.length, nTest: test.length, conf, from: test[0].trip.date, to: test[test.length - 1].trip.date, models, strat, edgesLearned: Object.keys(lr.L1).length };
};

/* ---------- Date SINTETICE regionale (doar pentru verificarea mecanismelor) ---------- */
E.synthetic = function (net, opts) {
  const o = Object.assign({ start: '2026-05-04', end: '2026-11-05', seed: 20261106, participants: 14 }, opts || {});
  const r = E.rng(o.seed), nrm = () => E.normal(r);
  const truth = JSON.parse(JSON.stringify(net));
  for (const e of Object.values(truth.edges)) { e.am = Math.min(0.97, Math.max(0.3, e.am + 0.06 * nrm())); e.pm = Math.min(0.97, Math.max(0.3, e.pm + 0.05 * nrm())); e.alpha *= Math.exp(0.2 * nrm()); }
  const origins = ['COR', 'BAL', 'OTO', 'VOL', 'PNT', 'POP', 'BRG', 'MAG', 'CHJ', 'DOM', 'BUF', 'CHT', 'TUN', 'BER', 'DRT', 'MIL', 'TIT', 'COL'];
  const dests = ['UPB', 'UNI', 'VIC', 'PIP', 'AVI', 'UNR', 'GNO', 'BAN'];
  const ppl = Array.from({ length: o.participants }, (_, i) => ({ o: origins[i % origins.length], d: dests[Math.floor(r() * dests.length)], dep: 380 + Math.floor(r() * 120) }));
  const keys = Object.keys(net.edges).filter(k => ['N', 'M', 'C', 'A'].includes(net.edges[k].cls));
  const incidents = [], trips = [], i0 = E.dayIndex(o.start), i1 = E.dayIndex(o.end);
  const wx = () => { const u = r(); return u < 0.70 ? 'senin' : u < 0.92 ? 'ploaie' : u < 0.97 ? 'torential' : 'ceata'; };
  for (let di = i0; di <= i1; di++) {
    const date = E.dateFromIndex(di); if (E.dayClass(date) !== 'lucr') continue;
    if (r() < 0.25) { const sid = keys[Math.floor(r() * keys.length)], st = 390 + Math.floor(r() * 150); incidents.push({ id: 'inc' + di, segId: sid, closedLanes: 1, startDate: date, startMin: st, endDate: date, endMin: st + 60 + Math.floor(r() * 120) }); }
  }
  const prior = new Model(net, []), tm = new Model(truth, incidents);
  let id = 0;
  for (let di = i0; di <= i1; di++) {
    const date = E.dateFromIndex(di); if (E.dayClass(date) !== 'lucr') continue;
    const weather = wx();
    for (const p of ppl) {
      if (r() < 0.12) continue; // absențe
      const dep = p.dep + Math.round(15 * nrm()), ctx = E.ctxFor(date, weather, false);
      const alts = prior.alternatives(p.o, p.d, date, dep, ctx, 2); if (!alts.length) continue;
      const path = alts[r() < 0.75 ? 0 : alts.length - 1].path;
      const dur = tm.simPath(path, date, dep, ctx, 1, Math.floor(r() * 1e9))[0];
      trips.push({ id: 'syn' + (++id), date, dep, dur: Math.round(dur * 10) / 10, orig: p.o, dest: p.d, path, weather, vacation: false, source: 'sintetic' });
    }
  }
  return { trips, incidents };
};

if (typeof module !== 'undefined') module.exports = E;
