// Analisis pita frekuensi bersama: dipakai batang di wallpaper dan cincin di tab Media.
const st = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0, kick: false };
const peak = { bass: 0.3, mid: 0.25, treble: 0.2 }; // pelacak puncak untuk penyesuaian otomatis
let avgBass = 0,
  lastBeat = -1e9,
  lastNow = -1;

const mean = (spec, a, b) => {
  let s = 0;
  for (let i = a; i <= b; i++) s += spec[i];
  return s / (b - a + 1) / 255;
};

// spec: Uint8Array dari analyser (atau null kalau tidak ada suara), sr: sample rate, now: cap waktu rAF (ms)
export function readBands(spec, sr, now) {
  if (now === lastNow) return st; // satu hitungan per frame, dipakai bersama
  const dt = Math.min(0.05, lastNow < 0 ? 0.016 : (now - lastNow) / 1000);
  lastNow = now;

  const raw = { bass: 0, mid: 0, treble: 0 };
  if (spec) {
    const hz = sr / 2 / spec.length;
    const at = (f) => Math.min(spec.length - 1, Math.max(0, Math.round(f / hz)));
    raw.bass = mean(spec, at(30), at(150));
    raw.mid = mean(spec, at(150), at(2000));
    raw.treble = mean(spec, at(2000), at(8000));
  }

  for (const k of ["bass", "mid", "treble"]) {
    peak[k] = Math.max(0.12, peak[k] * (1 - dt * 0.15), raw[k]);
    const v = Math.min(1, raw[k] / peak[k]);
    st[k] += (v - st[k]) * (v > st[k] ? 0.6 : Math.min(1, dt * 5)); // naik cepat, turun pelan
  }

  // dentuman: bass melonjak di atas rata-ratanya
  st.kick = st.bass > avgBass * 1.25 + 0.12 && st.bass > 0.45 && now - lastBeat > 180;
  avgBass += (st.bass - avgBass) * Math.min(1, dt * 3);
  if (st.kick) {
    lastBeat = now;
    st.beat = 1;
  } else st.beat = Math.max(0, st.beat - dt * 3.2);

  st.level = st.bass * 0.5 + st.mid * 0.35 + st.treble * 0.15;
  return st;
}

// isi `out` (panjang n) dengan tinggi batang 0..1 pada skala frekuensi logaritmik
export function logBars(spec, sr, out, fMin = 40, fMax = 14000) {
  const n = out.length;
  if (!spec) return out.fill(0);
  const hz = sr / 2 / spec.length;
  const edge = (k) => fMin * Math.pow(fMax / fMin, k / n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(1, Math.floor(edge(i) / hz));
    const hi = Math.min(spec.length - 1, Math.max(lo, Math.floor(edge(i + 1) / hz)));
    let m = 0;
    for (let k = lo; k <= hi; k++) if (spec[k] > m) m = spec[k];
    out[i] = Math.min(1, (m / 255) * (0.8 + 0.7 * (i / n))); // treble secara alami lebih lemah, diimbangi sedikit
  }
  return out;
}