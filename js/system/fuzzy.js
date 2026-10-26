// Pencocokan fuzzy: huruf pencarian harus muncul berurutan di teks, tidak harus bersebelahan
// ("wlp" cocok dengan "wallpapers", "pw" dengan "panel workspaces").
const MATCH = 16;     // tiap huruf yang cocok
const CONSEC = 8;     // huruf cocok yang bersebelahan dengan huruf cocok sebelumnya
const B_START = 12;   // cocok di huruf pertama teks
const B_WORD = 10;    // cocok di awal kata
const GAP = 1;        // denda per huruf yang dilompati di tengah
const isSep = (c) => /[\s\-_/.>:]/.test(c);

// q dan t sudah huruf kecil. Hasil: { score, idx } (idx = posisi huruf yang cocok di t) atau null
export function fuzzy(q, t) {
  const n = q.length, m = t.length;
  if (!n) return { score: 0, idx: [] };
  if (n > m) return null;
  let k = 0;
  for (let j = 0; j < m && k < n; j++) if (t[j] === q[k]) k++;
  if (k < n) return null;   // bukan subsekuens, tak perlu hitung lebih jauh

  const NEG = -1e9;
  const dp = Array.from({ length: n }, () => new Array(m).fill(NEG));     // skor terbaik bila q[i] cocok di t[j]
  const from = Array.from({ length: n }, () => new Array(m).fill(-1));    // untuk menelusuri balik posisinya
  const bonus = (j) => (j === 0 ? B_START : isSep(t[j - 1]) ? B_WORD : 0);

  for (let i = 0; i < n; i++) {
    let run = NEG, runJ = -1;   // run = max dari dp[i-1][j'] + GAP*j' untuk semua j' <= j-2
    for (let j = i; j < m; j++) {
      if (i > 0 && j >= 2) {
        const v = dp[i - 1][j - 2];
        if (v > NEG && v + GAP * (j - 2) > run) { run = v + GAP * (j - 2); runJ = j - 2; }
      }
      if (t[j] !== q[i]) continue;

      let prev, pj = -1;
      if (i === 0) prev = -Math.min(j, 6);   // makin jauh dari awal, makin kecil
      else {
        prev = NEG;
        const cons = j >= 1 ? dp[i - 1][j - 1] : NEG;
        if (cons > NEG) { prev = cons + CONSEC; pj = j - 1; }
        if (run > NEG) {
          const g = run - GAP * (j - 1);
          if (g > prev) { prev = g; pj = runJ; }
        }
        if (prev === NEG) continue;
      }
      dp[i][j] = MATCH + bonus(j) + prev;
      from[i][j] = pj;
    }
  }

  let best = NEG, bj = -1;
  for (let j = n - 1; j < m; j++) if (dp[n - 1][j] > best) { best = dp[n - 1][j]; bj = j; }
  if (best === NEG) return null;

  const idx = new Array(n);
  for (let i = n - 1, j = bj; i >= 0; i--) { idx[i] = j; j = from[i][j]; }

  let score = best;   // skor sama = urutan asli daftar (susunan buatan pengguna dihormati)
  if (t.startsWith(q)) score += 20;
  if (t === q) score += 20;
  return { score, idx };
}

// Beberapa kata dipisah spasi: semuanya harus cocok, urutan bebas ("media panel" = "panel media").
// Tiap kata dinilai bertingkat supaya hasilnya tidak mengejutkan:
//   1) kata muncul utuh di nama           -> paling atas (awalan lebih tinggi lagi)
//   2) kata muncul utuh di keterangan     -> di bawahnya ("tema" menemukan "wallpapers")
//   3) huruf tersebar di nama (fuzzy)     -> paling bawah, diurutkan menurut skor fuzzy
// Hasil: { score, idx } dengan idx = posisi huruf yang cocok di nama (untuk disorot), atau null
export function fuzzyMatch(query, name, hint = "") {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, idx: [] };
  const n = name.toLowerCase(), h = hint.toLowerCase();
  let total = 0;
  const idx = new Set();
  for (const tk of tokens) {
    const a = fuzzy(tk, n);
    if (a && n.includes(tk)) total += 2000 + a.score;
    else if (h.includes(tk)) total += 1000;
    else if (a) total += a.score;
    else return null;
    if (a && !(h.includes(tk) && !n.includes(tk))) a.idx.forEach((i) => idx.add(i));
  }
  return { score: total, idx: [...idx].sort((x, y) => x - y) };
}

// Urutkan daftar benda menurut kecocokan fuzzy. Hasil: [{ item, hl, score }], terbaik dulu.
// hl = posisi huruf yang cocok di nama (untuk disorot). Skor sama: urutan asli daftar.
export function rankFuzzy(query, items, getName, getHint = () => "") {
  return items
    .map((item, i) => ({ item, i, m: fuzzyMatch(query, getName(item), getHint(item)) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)
    .map((x) => ({ item: x.item, hl: x.m.idx, score: x.m.score }));
}