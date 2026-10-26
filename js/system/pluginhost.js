import { DEFS } from "../widgets/widgetdefs.js";
import { on, emit } from "../core/state.js";
import { openDialog } from "../core/dialog.js";
import { BUILTIN_PLUGINS } from "../core/builtin-assets.js";
import { PluginManager } from "../../core/plugin-manager.js";
import eventBus from "../../core/event-bus.js";

// Bridges the plugin system (core/) and the app: registers plugins as widgets,
// displays settings dialogs, and forwards selected app events to plugins.

const CACHE_KEY = "plug:index"; // ringkasan manifest terakhir, supaya widget plugin yang tersimpan tetap dikenali saat halaman dibuka
const TYPE = "plugin:";
export const isPluginType = (t) => typeof t === "string" && t.startsWith(TYPE);
const idOf = (type) => type.slice(TYPE.length);

export const manager = new PluginManager({
  baseUrl: new URL("../widgets/plugins/", import.meta.url).href,
  eventBus,
  toast: ({ title = "Plugin", message = "", type = "info", duration = 3500 } = {}) =>
    emit("toast", { title, message, type, duration }),
});

// ---- plugin sebagai widget ----
function defFor(rec) {
  const m = rec.manifest;
  return {
    name: m.name,
    icon: m.icon,
    desc: m.description || "Plugin",
    listed: true,
    unique: m.unique,
    plugin: true,
    // kode plugin baru diunduh di sini, saat widgetnya benar-benar dibuat
    mount(body, ctx) {
      const handle = manager.mount(rec.id, body, ctx);
      return { cleanup: () => handle.destroy(), onTap: () => handle.instance?.onTap?.() };
    },
  };
}

// plugin yang masih dipakai widget tersimpan tetapi hilang dari folder: tampilkan pesan, jangan hapus datanya
function missingDef(id) {
  const rec = manager.get(id);
  const why = rec?.status === "invalid" ? `invalid manifest: ${rec.error}` : "not found in the plugins/ folder";
  return {
    name: id,
    icon: "46_puzzle.png",
    desc: "",
    listed: false,
    plugin: true,
    mount(body) {
      const box = document.createElement("div");
      box.className = "plugin-error";
      box.textContent = `Plugin “${id}” ${why}.`;
      body.replaceChildren(box);
      return {};
    },
  };
}

function sync() {
  const live = new Set();
  for (const rec of manager.list()) {
    if (!rec.manifest) continue;
    DEFS[TYPE + rec.id] = defFor(rec);
    live.add(TYPE + rec.id);
  }
  for (const type of Object.keys(DEFS)) if (isPluginType(type) && !live.has(type)) DEFS[type] = missingDef(idOf(type));
  emit("plugins:changed");
}

// widget plugin tersimpan yang belum ada di cache (mis. cache terhapus): tahan dulu sampai daftar plugin selesai dibaca
let indexDone;
const indexReady = new Promise((r) => (indexDone = r));
function pendingDef(id) {
  const type = TYPE + id;
  const def = {
    name: id,
    icon: "46_puzzle.png",
    desc: "",
    listed: false,
    plugin: true,
    mount(body, ctx) {
      let dead = false,
        inner = null;
      const note = document.createElement("div");
      note.className = "plugin-loading";
      note.textContent = "Loading plugin…";
      body.replaceChildren(note);
      indexReady.then(() => {
        if (dead) return;
        const real = DEFS[type];
        if (real && real !== def) inner = real.mount(body, ctx);
        else {
          note.className = "plugin-error";
          note.textContent = `Could not load plugin “${id}” (plugin list could not be read).`;
        }
      });
      return {
        cleanup: () => {
          dead = true;
          inner?.cleanup?.();
        },
        onTap: () => inner?.onTap?.(),
      };
    },
  };
  return def;
}

/** Mulai mengunduh kode plugin di latar belakang (dipanggil saat pengguna mulai menahan widget di katalog). */
export function preloadPlugin(type) {
  if (isPluginType(type)) manager.preload(idOf(type));
}

// ---- dialog pengaturan: plugin cukup memancarkan "settings:open" dengan skema ----
const humanize = (k) => {
  const s = k.replace(/([A-Z])/g, " $1").replace(/[-_]+/g, " ").trim().toLowerCase();
  return s[0].toUpperCase() + s.slice(1);
};

eventBus.on("settings:open", async ({ plugin, config = {}, schema } = {}) => {
  if (!plugin || !schema || typeof schema !== "object") return;
  const rec = manager.get(plugin);
  const fields = Object.entries(schema).map(([name, s]) => {
    const label = s.label ?? humanize(name);
    const cur = config[name];
    if (s.type === "select")
      return { name, label, type: "select", options: (s.options ?? []).map((o) => [String(o), String(o)]), value: String(cur ?? "") };
    if (s.type === "boolean")
      return { name, label, type: "select", options: [["true", "Yes"], ["false", "No"]], value: String(!!cur) };
    return { name, label, type: s.type === "number" ? "number" : "text", value: cur == null ? "" : String(cur), placeholder: s.placeholder, maxlength: s.maxlength ?? 80 };
  });
  const v = await openDialog({
    title: `Settings for ${rec?.manifest.name ?? plugin}`,
    fields,
    validate: (vals) => {
      for (const [name, s] of Object.entries(schema)) {
        if (s.type !== "number" || vals[name] === "") continue;
        const n = Number(vals[name]);
        if (!Number.isFinite(n) || (s.min != null && n < s.min) || (s.max != null && n > s.max))
          return `${s.label ?? humanize(name)} must be a number${s.min != null ? ` (min ${s.min}` : ""}${s.max != null ? `, max ${s.max}` : ""}${s.min != null ? ")" : ""}.`;
      }
      return "";
    },
  });
  if (!v) return;
  const next = {};
  for (const [name, s] of Object.entries(schema)) {
    if (v[name] === undefined || v[name] === "") continue; // kosong = biarkan nilai sekarang
    next[name] = s.type === "boolean" ? v[name] === "true" : s.type === "number" ? Number(v[name]) : v[name];
  }
  eventBus.emit("settings:updated", { plugin, config: next });
});

// ---- peristiwa aplikasi yang diteruskan ke plugin, dengan awalan "app:" ----
for (const ev of ["audio:track", "audio:play", "theme:changed", "power:on"]) on(ev, (data) => eventBus.emit("app:" + ev, data));

// ---- mulai ----
// 1) daftar tersimpan didaftarkan sinkron, sebelum widgets.js membaca widget tersimpan
try {
  manager.registerMany(JSON.parse(localStorage.getItem(CACHE_KEY)));
} catch {}
sync();
try {
  for (const w of JSON.parse(localStorage.getItem("widgets")) ?? [])
    if (isPluginType(w?.type) && !DEFS[w.type]) DEFS[w.type] = pendingDef(idOf(w.type));
} catch {}

// 2) segarkan daftar dari registry statis dan manifest tiap plugin
manager.loadPlugins(BUILTIN_PLUGINS).then((ok) => {
  if (!ok) {
    indexDone();
    emit("toast", { title: "Plugin", message: "Invalid plugin list.", type: "error" });
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(manager.export()));
  } catch {}
  sync();
  indexDone();
  const bad = manager.list().filter((r) => !r.manifest);
  if (bad.length) {
    for (const r of bad) console.warn(`[plugin:${r.id}] invalid manifest: ${r.error}`);
    emit("toast", { title: "Plugin", message: `${bad.length} plugins skipped because their manifests are invalid (see Console)`, type: "warn", duration: 5000 });
  }
});