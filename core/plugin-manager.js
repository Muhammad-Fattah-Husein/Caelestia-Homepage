/**
 * PluginManager: memuat plugin secara on-demand lewat dynamic import().
 *
 * Alur singkat:
 *   loadPlugins(ids) -> baca manifest plugin yang didaftarkan aplikasi
 *   mount(id, container, widget)
 *                -> saat plugin benar-benar dipakai: import() kode, muat CSS,
 *                   buat instance, panggil init(); destroy() saat dibuang
 *
 * Manajer ini tidak tahu apa-apa tentang aplikasi tempat ia dipasang. Hubungan ke
 * aplikasi (daftar widget, toast, dialog pengaturan) dipasang dari luar, lihat
 * js/system/pluginhost.js.
 */
import eventBus from "./event-bus.js";

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const PERMISSIONS = new Set(["storage"]); // izin yang dikenal; "storage" benar-benar ditegakkan
const RESERVED_EVENT = /^(plugin|plugins|app):/; // awalan khusus milik inti

// path relatif di dalam folder plugin, tanpa "..", tanpa protokol, dan dengan ekstensi yang benar
const safePath = (p, ext) =>
  typeof p === "string" &&
  p.length > 0 &&
  !/^([a-z][a-z0-9+.-]*:|[\\/])/i.test(p) &&
  !p.split(/[\\/]/).includes("..") &&
  ext.test(p);

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// ---- versi sederhana: "*", "1.2.3", ">=1.2.0", "^1.2.0", "~1.2.0" ----
const parseVer = (v) =>
  String(v)
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0)
    .concat([0, 0, 0])
    .slice(0, 3);
const cmpVer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
};
export function satisfies(version, range = "*") {
  range = String(range).trim();
  if (!range || range === "*") return true;
  const m = /^(>=|<=|>|<|\^|~|=)?\s*(.+)$/.exec(range);
  const op = m[1] ?? "=";
  const v = parseVer(version),
    r = parseVer(m[2]);
  const c = cmpVer(v, r);
  switch (op) {
    case ">=": return c >= 0;
    case ">": return c > 0;
    case "<=": return c <= 0;
    case "<": return c < 0;
    case "^": return v[0] === r[0] && c >= 0;
    case "~": return v[0] === r[0] && v[1] === r[1] && c >= 0;
    default: return c === 0;
  }
}

// ---- manifest ----
export function validateManifest(id, raw) {
  const errors = [];
  if (!ID_RE.test(id)) errors.push(`id "${id}" tidak valid (huruf kecil, angka, - dan _)`);
  if (!isObj(raw)) return { ok: false, errors: [...errors, "manifest.json harus berupa objek"] };

  if (typeof raw.name !== "string" || !raw.name.trim()) errors.push('"name" wajib diisi');
  if (!safePath(raw.entry, /\.m?js$/i)) errors.push('"entry" harus path relatif ke file .js di dalam folder plugin');
  const styles = raw.styles == null ? [] : Array.isArray(raw.styles) ? raw.styles : [raw.styles];
  if (!styles.every((s) => safePath(s, /\.css$/i))) errors.push('"styles" harus path relatif ke file .css');
  const permissions = raw.permissions ?? [];
  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === "string"))
    errors.push('"permissions" harus berupa daftar teks');
  const dependencies = raw.dependencies ?? {};
  if (!isObj(dependencies) || !Object.keys(dependencies).every((d) => ID_RE.test(d)))
    errors.push('"dependencies" harus berupa objek { idPlugin: "versi" }');
  const config = raw.config ?? {};
  if (!isObj(config)) errors.push('"config" harus berupa objek');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    warnings: permissions.filter((p) => !PERMISSIONS.has(p)).map((p) => `izin "${p}" tidak dikenal`),
    manifest: {
      name: raw.name.trim(),
      version: String(raw.version ?? "0.0.0"),
      author: String(raw.author ?? ""),
      description: String(raw.description ?? ""),
      icon: typeof raw.icon === "string" && raw.icon ? raw.icon : "46_puzzle.png",
      unique: raw.unique === true, // true: hanya boleh satu widget
      entry: raw.entry,
      styles,
      permissions,
      dependencies,
      config,
    },
  };
}

const fetchJson = async (url) => {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.json();
};

export class PluginManager {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl]   folder plugin, relatif terhadap halaman ("plugins/")
   * @param {object} [opts.eventBus]  saluran pesan bersama (bawaan: core/event-bus.js)
   * @param {Function} [opts.toast]   ({ title, message, type }) => void
   */
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl ?? "plugins/";
    this.events = opts.eventBus ?? eventBus;
    this.toast = opts.toast ?? (() => {});
    this.registry = new Map(); // id -> { id, manifest, status, error }
    this.modules = new Map(); // id -> Promise<class>
    this.handles = new Map(); // id -> Set<handle>
    this.versions = new Map(); // id -> token untuk melewati cache saat reload
  }

  // ---- daftar plugin ----
  _abs(path) {
    return new URL(path, document.baseURI).href;
  }

  /** Membaca manifest untuk ID plugin yang didaftarkan aplikasi. */
  async loadPlugins(pluginIds) {
    if (!Array.isArray(pluginIds) || !pluginIds.every((id) => typeof id === "string")) {
      const error = new Error("Daftar plugin harus berupa array ID teks");
      this.events.emit("plugins:index", { ok: false, error });
      return false;
    }
    const ids = [...new Set(pluginIds)];
    const found = new Map();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const v = validateManifest(id, await fetchJson(this._abs(`${this.baseUrl}${id}/manifest.json`)));
          if (!v.ok) return found.set(id, { id, manifest: null, status: "invalid", error: v.errors.join("; ") });
          v.warnings.forEach((w) => console.warn(`[plugin:${id}] ${w}`));
          found.set(id, { id, manifest: v.manifest, status: this.registry.get(id)?.status === "loaded" ? "loaded" : "available", error: null });
        } catch (err) {
          found.set(id, { id, manifest: null, status: "invalid", error: err.message });
        }
      }),
    );
    this.registry = new Map(ids.map((id) => [id, found.get(id)]));
    this.events.emit("plugins:index", { ok: true, count: this.registry.size });
    return true;
  }

  /** Mendaftarkan daftar yang tersimpan (tanpa jaringan), mis. dari cache. */
  registerMany(items) {
    for (const it of items ?? []) {
      if (!it || typeof it.id !== "string") continue;
      const v = validateManifest(it.id, it.manifest);
      if (v.ok && !this.registry.has(it.id)) this.registry.set(it.id, { id: it.id, manifest: v.manifest, status: "available", error: null });
    }
  }

  export() {
    return [...this.registry.values()].filter((r) => r.manifest).map((r) => ({ id: r.id, manifest: r.manifest }));
  }
  list() {
    return [...this.registry.values()];
  }
  get(id) {
    return this.registry.get(id) ?? null;
  }

  // ---- memuat kode ----
  _url(rec, path) {
    const u = new URL(`${this.baseUrl}${rec.id}/${path}`, document.baseURI);
    const v = this.versions.get(rec.id);
    if (v) u.searchParams.set("v", v);
    return u.href;
  }

  _assertNoCycle(id, path = []) {
    if (path.includes(id)) throw new Error(`dependensi melingkar: ${[...path, id].join(" → ")}`);
    for (const dep of Object.keys(this.registry.get(id)?.manifest?.dependencies ?? {})) this._assertNoCycle(dep, [...path, id]);
  }

  _loadStyles(rec) {
    return Promise.all(
      rec.manifest.styles.map(
        (file) =>
          new Promise((resolve) => {
            const href = this._url(rec, file);
            const old = [...document.querySelectorAll("link[data-plugin]")].find((l) => l.dataset.plugin === rec.id && l.getAttribute("href") === href);
            if (old) return resolve();
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.setAttribute("href", href);
            link.dataset.plugin = rec.id;
            link.addEventListener("load", () => resolve());
            link.addEventListener("error", () => {
              console.warn(`[plugin:${rec.id}] gagal memuat ${file}`);
              resolve(); // gaya yang hilang tidak boleh menggagalkan plugin
            });
            document.head.append(link);
          }),
      ),
    );
  }
  _removeStyles(id) {
    for (const l of [...document.querySelectorAll("link[data-plugin]")]) if (l.dataset.plugin === id) l.remove();
  }

  /** Memuat kelas plugin (dan CSS-nya). Hasilnya di-cache; panggilan berikutnya instan. */
  load(id) {
    const rec = this.registry.get(id);
    if (!rec) return Promise.reject(new Error(`plugin "${id}" tidak terdaftar`));
    if (!rec.manifest) return Promise.reject(new Error(`manifest "${id}" tidak valid: ${rec.error}`));
    if (!this.modules.has(id)) {
      const p = this._load(rec).catch((err) => {
        this.modules.delete(id); // izinkan percobaan ulang
        rec.status = "error";
        rec.error = err.message;
        this.events.emit("plugin:error", { id, error: err });
        throw err;
      });
      this.modules.set(id, p);
    }
    return this.modules.get(id);
  }
  /** Mulai mengunduh di latar belakang, mis. saat pengguna mulai menahan widget di katalog. */
  preload(id) {
    return this.load(id).catch(() => {});
  }

  async _load(rec) {
    const deps = rec.manifest.dependencies;
    this._assertNoCycle(rec.id); // sebelum memuat apa pun, supaya tidak saling menunggu selamanya
    for (const [dep, range] of Object.entries(deps)) {
      const d = this.registry.get(dep);
      if (!d?.manifest) throw new Error(`butuh plugin "${dep}" yang tidak tersedia`);
      if (!satisfies(d.manifest.version, range)) throw new Error(`butuh "${dep}" ${range}, yang ada ${d.manifest.version}`);
    }
    await Promise.all(Object.keys(deps).map((d) => this.load(d)));
    const [mod] = await Promise.all([import(/* @vite-ignore */ this._url(rec, rec.manifest.entry)), this._loadStyles(rec)]);
    const Plugin = mod.default ?? mod.Plugin;
    if (typeof Plugin !== "function") throw new Error("index.js harus mengekspor kelas plugin sebagai default export");
    rec.status = "loaded";
    rec.error = null;
    this.events.emit("plugin:loaded", { id: rec.id });
    return Plugin;
  }

  // ---- memasang ke sebuah wadah ----
  /**
   * Memasang plugin ke `container`. Mengembalikan handle langsung; kode dimuat di latar belakang.
   * @param {string} id
   * @param {HTMLElement} container  wadah milik widget
   * @param {object} [widget]        { id, data, isNew, save } dari sistem widget (opsional)
   */
  mount(id, container, widget = {}) {
    const handle = { id, container, widget, instance: null, subs: [], status: "loading", error: null, destroyed: false, closing: null };
    handle.destroy = () => this._destroy(handle);
    if (!this.handles.has(id)) this.handles.set(id, new Set());
    this.handles.get(id).add(handle);
    handle.ready = this._start(handle);
    return handle;
  }

  async _start(handle) {
    const { id } = handle;
    handle.status = "loading";
    const loading = document.createElement("div");
    loading.className = "plugin-loading";
    loading.textContent = "Memuat plugin…";
    handle.container.replaceChildren(loading);
    try {
      const Plugin = await this.load(id);
      if (handle.destroyed) return;
      const ctx = this._context(handle);
      const stored = ctx.storage.get("config", {});
      const instance = new Plugin(ctx, isObj(stored) ? stored : {});
      handle.instance = instance;
      loading.remove();
      await instance.init?.();
      if (handle.destroyed) return;
      handle.status = "running";
      this.events.emit("plugin:started", { id });
    } catch (err) {
      handle.status = "error";
      handle.error = err;
      console.error(`[plugin:${id}]`, err);
      await this._teardown(handle);
      if (handle.destroyed) return;
      this._showError(handle, err);
      this.events.emit("plugin:error", { id, error: err });
      this.toast({ title: "Plugin", message: `"${this.registry.get(id)?.manifest?.name ?? id}" gagal: ${err.message}`, type: "error" });
    }
  }

  _showError(handle, err) {
    const box = document.createElement("div");
    box.className = "plugin-error";
    box.setAttribute("role", "alert");
    const msg = document.createElement("div");
    msg.textContent = `Plugin “${this.registry.get(handle.id)?.manifest?.name ?? handle.id}” gagal dimuat: ${err.message}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Coba lagi";
    retry.addEventListener("click", () => this.reload(handle.id));
    box.append(msg, retry);
    handle.container.replaceChildren(box);
  }

  async _teardown(handle) {
    const inst = handle.instance;
    handle.instance = null;
    try {
      await inst?.destroy?.();
    } catch (err) {
      console.error(`[plugin:${handle.id}] destroy gagal:`, err);
    }
    for (const s of handle.subs.splice(0)) {
      try {
        s.off();
      } catch {}
    }
    handle.container?.replaceChildren();
    this.events.emit("plugin:destroyed", { id: handle.id });
  }

  _destroy(handle) {
    if (handle.closing) return handle.closing;
    handle.destroyed = true;
    handle.closing = (async () => {
      await handle.ready.catch(() => {});
      await this._teardown(handle);
      this.handles.get(handle.id)?.delete(handle);
      handle.status = "destroyed";
    })();
    return handle.closing;
  }

  /** Muat ulang kode plugin dan jalankan ulang semua instance-nya (berguna saat mengembangkan plugin). */
  async reload(id) {
    const rec = this.registry.get(id);
    if (!rec) throw new Error(`plugin "${id}" tidak terdaftar`);
    this.versions.set(id, String(Date.now())); // melewati cache browser
    this.modules.delete(id);
    this._removeStyles(id);
    rec.status = "available";
    rec.error = null;
    const hs = [...(this.handles.get(id) ?? [])].filter((h) => !h.destroyed);
    await Promise.all(
      hs.map(async (h) => {
        await h.ready.catch(() => {});
        await this._teardown(h);
        h.error = null;
        h.ready = this._start(h);
      }),
    );
    await Promise.all(hs.map((h) => h.ready));
  }

  /** Mematikan semua instance, membuang CSS dan cache kode. */
  async unload(id) {
    await Promise.all([...(this.handles.get(id) ?? [])].map((h) => h.destroy()));
    this._removeStyles(id);
    this.modules.delete(id);
    const rec = this.registry.get(id);
    if (rec) rec.status = "available";
  }

  getInstances(id) {
    return [...(this.handles.get(id) ?? [])].map((h) => h.instance).filter(Boolean);
  }

  // ---- konteks yang diterima plugin ----
  _context(handle) {
    const { id } = handle;
    const rec = this.registry.get(id);
    const perms = new Set(rec.manifest.permissions);
    const log = (...a) => console.log(`[plugin:${id}]`, ...a);
    const warn = (...a) => console.warn(`[plugin:${id}]`, ...a);

    // pendengar dibungkus supaya semuanya otomatis dilepas saat plugin dibuang
    const bus = this.events;
    const subscribe = (kind) => (event, cb, thisArg = null) => {
      const wrapped = (data) => cb.call(thisArg, data);
      const off = bus[kind](event, wrapped);
      const sub = { event, cb, off };
      handle.subs.push(sub);
      return () => {
        off();
        const i = handle.subs.indexOf(sub);
        if (i >= 0) handle.subs.splice(i, 1);
      };
    };
    const events = {
      on: subscribe("on"),
      once: subscribe("once"),
      off(event, cb) {
        const i = handle.subs.findIndex((s) => s.event === event && s.cb === cb);
        if (i >= 0) handle.subs.splice(i, 1)[0].off();
      },
      emit(event, data) {
        if (RESERVED_EVENT.test(event)) return warn(`awalan event "${event}" dicadangkan untuk inti`);
        bus.emit(event, data);
      },
    };

    const prefix = `plugin:${id}:`;
    let warned = false;
    const denied = (fallback) => {
      if (!warned) warn('butuh izin "storage" di manifest.json untuk memakai storage');
      warned = true;
      return fallback;
    };
    const storage = perms.has("storage")
      ? {
          get(key, fallback = null) {
            try {
              return JSON.parse(localStorage.getItem(prefix + key)) ?? fallback;
            } catch {
              return fallback;
            }
          },
          set(key, value) {
            try {
              localStorage.setItem(prefix + key, JSON.stringify(value));
              return true;
            } catch {
              return false;
            }
          },
          remove: (key) => localStorage.removeItem(prefix + key),
          clear() {
            for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
          },
        }
      : { get: (_k, fb = null) => denied(fb), set: () => denied(false), remove: () => denied(), clear: () => denied() };

    const createElement = (tag, props = {}, ...children) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (k === "dataset") Object.assign(el.dataset, v);
        else if (k === "style" && v && typeof v === "object") Object.assign(el.style, v);
        else if (k === "attrs") for (const [a, val] of Object.entries(v)) el.setAttribute(a, val);
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in el) el[k] = v;
        else el.setAttribute(k, v);
      }
      el.append(...children);
      return el;
    };

    const declared = (dep) => {
      if (Object.hasOwn(rec.manifest.dependencies, dep)) return true;
      warn(`"${dep}" belum dideklarasikan di "dependencies"`);
      return false;
    };

    return {
      id,
      manifest: Object.freeze(structuredClone(rec.manifest)),
      widget: handle.widget, // { id, data, isNew, save } milik widget ini, kalau dipasang lewat sistem widget
      createElement,
      getContainer: () => handle.container,
      events,
      storage,
      log,
      warn,
      toast: (o = {}) => this.toast({ title: rec.manifest.name, ...o }),
      /** Instance pertama dari plugin yang dideklarasikan di dependencies (atau null). */
      getPlugin: (dep) => (declared(dep) ? this.getInstances(dep)[0] ?? null : null),
      /** Kelas plugin dependensi, dimuat bila perlu. */
      use: (dep) => (declared(dep) ? this.load(dep) : Promise.reject(new Error(`"${dep}" belum dideklarasikan`))),
    };
  }
}

export default PluginManager;