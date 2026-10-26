import { emit } from "../core/state.js";
import { startTimer, cancelTimers, activeCount, human } from "../widgets/timer.js";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const clean = (v, p = 12) => Number(v.toPrecision(p));   // buang sisa pembulatan: 0.1+0.2 jadi 0.3
const fmt = (v) => nf.format(clean(v));

async function copy(text, shown) {
  try {
    await navigator.clipboard.writeText(text);
    emit("toast", { title: "Copied", message: shown, duration: 2000 });
  } catch {
    emit("toast", { title: "Result", message: shown, duration: 4000 });   // clipboard requires HTTPS or localhost
  }
}

// =====================================================================
// 1) Kalkulator: pemecah ekspresi sendiri, tanpa eval
// =====================================================================
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  ln: Math.log, log: Math.log10,
  sin: (x) => Math.sin((x * Math.PI) / 180),   // sudut dalam derajat
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
};
const CONSTS = { pi: Math.PI, e: Math.E };

function normalize(raw) {
  let s = raw.toLowerCase().trim();
  s = s.replace(/×/g, "*").replace(/÷/g, "/");
  s = s.replace(/(\d|\))\s*x\s*(?=[\d(.\-])/g, "$1*");   // "3 x 4" -> "3*4"
  if (!s.includes(".")) s = s.replace(/,/g, ".");        // koma dianggap desimal
  return s;
}

function tokenize(src) {
  const toks = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([a-z]+)|(\*\*|[-+*/^%()]))/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) return /^\s*$/.test(src.slice(pos)) ? toks : null;
    pos = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: "n", v: parseFloat(m[1]) });
    else if (m[2]) toks.push({ t: "id", v: m[2] });
    else toks.push({ t: "op", v: m[3] === "**" ? "^" : m[3] });
  }
  return toks;
}

function evaluate(toks) {
  let i = 0;
  const isOp = (v) => toks[i]?.t === "op" && toks[i].v === v;
  const fail = () => { throw new SyntaxError("Invalid expression"); };

  function expr() {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = toks[i++].v;
      const start = i;
      const right = term();
      // "200+10%" berarti 200 ditambah 10% dari 200
      const rel = i - start === 2 && toks[start].t === "n" && toks[i - 1].v === "%";
      const r = rel ? left * right : right;
      left = op === "+" ? left + r : left - r;
    }
    return left;
  }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp("*")) { i++; v *= unary(); }
      else if (isOp("/")) { i++; v /= unary(); }
      else if (isOp("(") || toks[i]?.t === "id") v *= unary();   // 2(3+4), 2pi
      else return v;
    }
  }
  function unary() {
    if (isOp("-")) { i++; return -unary(); }
    if (isOp("+")) { i++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp("^")) { i++; return base ** unary(); }
    return base;
  }
  function postfix() {
    let v = primary();
    while (isOp("%")) { i++; v /= 100; }
    return v;
  }
  function primary() {
    const t = toks[i++];
    if (!t) fail();
    if (t.t === "n") return t.v;
    if (t.t === "id") {
      if (Object.hasOwn(CONSTS, t.v)) return CONSTS[t.v];
      if (Object.hasOwn(FUNCS, t.v) && isOp("(")) {
        i++;
        const a = expr();
        if (!isOp(")")) fail();
        i++;
        return FUNCS[t.v](a);
      }
      fail();
    }
    if (t.v === "(") {
      const v = expr();
      if (!isOp(")")) fail();
      i++;
      return v;
    }
    fail();
  }

  const v = expr();
  if (i !== toks.length) fail();
  return v;
}

function calcValue(raw) {
  const toks = tokenize(normalize(raw));
  return toks?.length ? evaluate(toks) : null;
}

function calcItem(q) {
  if (q.length > 100 || !/\d/.test(q)) return null;
  const s = normalize(q);
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return null;                     // angka biasa bukan hitungan
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(s)) return null;      // tanggal, mis. 2026-10-13

  let expr = q, v;
  try {
    const p = /^(\d+(?:[.,]\d+)?)\s*%\s*(?:dari|of)\s+(.+)$/i.exec(q.trim());   // "15% dari 200"
    if (p) expr = `(${p[1]})/100*(${p[2]})`;
    const toks = tokenize(normalize(expr));
    if (!toks?.some((t) => t.t === "id" || (t.t === "op" && t.v !== "(" && t.v !== ")"))) return null;
    v = evaluate(toks);
  } catch { return null; }
  if (!Number.isFinite(v)) return null;

  const shown = fmt(v);
  return {
    label: `${q.trim()} = ${shown}`,
    hint: "Enter: copy · Tab: use result",
    fill: String(clean(v)),
    run: () => copy(String(clean(v)), shown),
  };
}

// =====================================================================
// 2) Konversi satuan: "5 km ke mi", "100 f to c", "2 jam ke menit"
// =====================================================================
const CATS = {
  panjang:   { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  massa:     { mg: 0.001, g: 1, kg: 1000, ons: 100, oz: 28.349523125, lb: 453.59237, ton: 1e6 },
  volume:    { ml: 1, l: 1000, gal: 3785.411784, floz: 29.5735295625 },
  waktu:     { detik: 1, menit: 60, jam: 3600, hari: 86400, minggu: 604800, sec: 1, min: 60, hr: 3600, day: 86400, week: 604800 },
  data:      { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 },   // 1 KB = 1024 B, seperti di sistem operasi
  kecepatan: { "m/s": 1, "km/jam": 1000 / 3600, mph: 1609.344 / 3600, knot: 1852 / 3600 },
  luas:      { cm2: 0.0001, m2: 1, km2: 1e6, ha: 1e4, ft2: 0.09290304, acre: 4046.8564224 },
};
const ALIAS = {
  milimeter: "mm", sentimeter: "cm", meter: "m", kilometer: "km",
  inci: "in", inch: "in", inches: "in", kaki: "ft", feet: "ft", foot: "ft", yard: "yd",
  mil: "mi", mile: "mi", miles: "mi",
  miligram: "mg", gram: "g", kilogram: "kg", pound: "lb", pounds: "lb", lbs: "lb", ounce: "oz",
  cc: "ml", liter: "l", ltr: "l", galon: "gal", gallon: "gal",
  s: "sec", seconds: "sec", second: "sec", secs: "sec", dtk: "detik", detik: "sec",
  minutes: "min", minute: "min", mins: "min", mnt: "menit", menit: "min", m: "min",
  hours: "hr", hour: "hr", hrs: "hr", h: "hr", j: "jam", jam: "hr",
  days: "day", hari: "day", weeks: "week", minggu: "week",
  byte: "b", kilobyte: "kb", megabyte: "mb", gigabyte: "gb", terabyte: "tb",
  "km/h": "km/jam", kmh: "km/jam", kph: "km/jam", mps: "m/s", knots: "knot", hektar: "ha",
  celsius: "c", fahrenheit: "f", kelvin: "k",
};
const TEMP = ["c", "f", "k"];
const SHOW = { c: "°C", f: "°F", k: "K", b: "B", kb: "KB", mb: "MB", gb: "GB", tb: "TB", sec: "sec", min: "min", hr: "hr", day: "days", week: "weeks" };
const show = (k) => SHOW[k] ?? k;

function findUnit(raw) {
  let u = raw.toLowerCase().replace(/°/g, "").replace(/²/g, "2");
  u = Object.hasOwn(ALIAS, u) ? ALIAS[u] : u;
  if (TEMP.includes(u)) return { cat: "suhu", key: u };
  for (const [cat, units] of Object.entries(CATS)) {
    if (Object.hasOwn(units, u)) return { cat, key: u, f: units[u] };
  }
  return null;
}

const toKelvin = { c: (v) => v + 273.15, f: (v) => ((v - 32) * 5) / 9 + 273.15, k: (v) => v };
const fromKelvin = { c: (k) => k - 273.15, f: (k) => ((k - 273.15) * 9) / 5 + 32, k: (k) => k };

function convertItem(q) {
  const U = "[a-z°²/][a-z°²/\\d]*";
  const m = new RegExp(`^(-?\\d+(?:[.,]\\d+)?)\\s*(${U})\\s*(?:to|ke|in|dalam|=|->|→)\\s*(${U})$`, "i").exec(q.trim());
  if (!m) return null;
  const a = findUnit(m[2]), b = findUnit(m[3]);
  if (!a || !b || a.cat !== b.cat) return null;

  const value = parseFloat(m[1].replace(",", "."));
  const out = a.cat === "suhu"
    ? fromKelvin[b.key](toKelvin[a.key](value))
    : (value * a.f) / b.f;
  if (!Number.isFinite(out)) return null;

  const shown = `${fmt(out)} ${show(b.key)}`;
  return {
    label: `${fmt(value)} ${show(a.key)} = ${shown}`,
    hint: "Enter: copy · Tab: use result",
    fill: shown,
    run: () => copy(String(clean(out, 10)), shown),
  };
}

// =====================================================================
// 3) Perintah cepat: "timer 10 menit", "timer 1 jam 30 menit teh", "timer batal"
// =====================================================================
const T_UNITS = [
  [/^(?:seconds?|secs?|detik|dtk|dt|s)$/, 1],
  [/^(?:minutes?|mins?|menit|mnt|min|m)$/, 60],
  [/^(?:hours?|hrs?|jam|j|hr|h)$/, 3600],
];

export function parseTimer(text) {
  const m = /^(?:set\s+)?(?:timer|hitung mundur|countdown)\s+(.+)$/i.exec(text.trim());
  if (!m) return null;
  let rest = m[1].trim();
  let secs = 0, found = false;
  const re = /^(\d+(?:[.,]\d+)?)\s*([a-z]*)\s*/i;
  for (let mm; (mm = re.exec(rest)); ) {
    const n = parseFloat(mm[1].replace(",", "."));
    const unit = mm[2].toLowerCase() || (found ? "" : "menit");   // angka tanpa satuan = menit
    const f = T_UNITS.find(([r]) => r.test(unit))?.[1];
    if (!f) break;
    secs += n * f;
    found = true;
    rest = rest.slice(mm[0].length);
  }
  secs = Math.round(secs);
  if (!found || secs < 1 || secs > 86400) return null;   // 1 detik sampai 24 jam
  return { secs, label: rest.trim().slice(0, 30) };
}

function timerItems(q) {
  if (!/^(?:set\s+)?(?:timer|hitung mundur|countdown)\b/i.test(q)) return null;

  if (/^timer\s+(?:batal|cancel|stop|hapus)$/i.test(q.trim())) {
    return [{ label: "Cancel all timers", hint: `${activeCount()} active`, run: cancelTimers }];
  }
  const t = parseTimer(q);
  if (t) {
    return [{
      label: `Timer ${human(t.secs)}${t.label ? " · " + t.label : ""}`,
      hint: "Enter: start",
      run: () => startTimer(t.secs, t.label),
    }];
  }
  const items = [{ label: "Timer…", hint: "Examples: timer 10 min · timer 1 hr 30 min", fill: "timer ", keepOpen: true, run() {} }];
  if (activeCount()) items.push({ label: "Cancel all timers", hint: `${activeCount()} active`, run: cancelTimers });
  return items;
}

// =====================================================================
// Pintu masuk untuk launcher
// =====================================================================
export function smartItems(q) {
  if (!q) return [];
  try {
    const timer = timerItems(q);
    if (timer) return timer;
    const conv = convertItem(q);
    if (conv) return [conv];
    const calc = calcItem(q);
    return calc ? [calc] : [];
  } catch (err) {
    console.warn("Smart search failed:", err);
    return [];
  }
}

// dipakai terminal: satu baris hasil, atau null kalau bukan hitungan atau konversi
export function calcLine(q) {
  try {
    return (convertItem(q) ?? calcItem(q))?.label ?? null;
  } catch {
    return null;
  }
}