// Pegas fisika satu dimensi: gaya = -kekakuan × jarak - redaman × kecepatan.
// Rasio redaman ζ = redaman / (2·√(kekakuan·massa)): < 1 = ada pantulan, 1 = tanpa pantulan.
export const PRESETS = {
  follow: { stiffness: 320, damping: 26 },   // ζ≈0,73: mengikuti kursor dengan sedikit tertinggal
  settle: { stiffness: 380, damping: 20 },   // ζ≈0,51: meluncur ke tempatnya dengan pantulan kecil
  lift:   { stiffness: 500, damping: 30 },   // ζ≈0,67: mengangkat dan menurunkan (skala)
  tilt:   { stiffness: 220, damping: 18 },   // ζ≈0,61: kemiringan mengikuti kecepatan
};

export class Spring {
  constructor(value = 0, cfg = PRESETS.follow) {
    this.value = value;
    this.target = value;
    this.v = 0;
    this.config(cfg);
  }
  config({ stiffness, damping, mass = 1, precision = 0.02 }) {
    this.k = stiffness;
    this.c = damping;
    this.m = mass;
    this.eps = precision;   // di bawah ini dianggap sudah diam
  }
  to(target) { this.target = target; }
  snap(value) { this.value = this.target = value; this.v = 0; }

  // maju sejauh dt detik; dipecah jadi langkah kecil supaya stabil walau frame lambat
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.k * (this.value - this.target) - this.c * this.v) / this.m;
      this.v += a * h;
      this.value += this.v * h;
    }
  }
  get settled() {
    return Math.abs(this.value - this.target) < this.eps && Math.abs(this.v) < this.eps * 10;
  }
}