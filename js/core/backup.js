import { STORAGE_KEYS, freezeSaves } from "./prefs.js";

const APP = "caelestia-homepage";
const VERSION = 1;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NOTES = 50000;

// bagian-bagian yang bisa dicentang saat impor
const SECTIONS = [
  { id: "shortcuts", label: "Shortcut", keys: ["shortcuts"] },
  { id: "notes", label: "Notes", keys: ["notes", "keys"] },
  { id: "widgets", label: "Desktop widgets", keys: ["widgets", "fx"] },
  { id: "look", label: "Theme, screen filters, and workspace", keys: ["theme", "workspace", "filter", "wdgrid"] },
  { id: "prefs", label: "Settings (profile, search, appearance)", keys: ["prefs"] },
];

const CHECK = {   // apakah bagian itu di berkas bentuknya masuk akal
  shortcuts: (d) => Array.isArray(d.shortcuts),
  notes: (d) => typeof d.notes === "string",
  widgets: (d) => Array.isArray(d.widgets),
  look: (d) => ["theme", "workspace", "filter"].some((k) => d[k] !== undefined),
  prefs: (d) => d.prefs && typeof d.prefs === "object" && !Array.isArray(d.prefs),
};

const SUMMARY = {
  shortcuts: (d) => `${d.shortcuts.length} shortcut`,
  notes: (d) => `${d.notes.length} karakter`,
  widgets: (d) => `${d.widgets.length} widget`,
  look: (d) => ["theme", "workspace", "filter"]
    .filter((k) => d[k] !== undefined)
    .map((k) => ({ theme: "theme", workspace: "workspace", filter: "screen filters" })[k])
    .join(", "),
  prefs: () => "profile, search, appearance",
};

function readKey(k) {
  let raw;
  try { raw = localStorage.getItem(k); } catch { return undefined; }
  if (raw == null) return undefined;
  if (k === "notes") return raw;                                // teks biasa
  try { return JSON.parse(raw); } catch { return undefined; }   // sisanya angka, larik, atau objek
}

export function exportBackup(tag = "") {
  const data = {};
  for (const k of STORAGE_KEYS) {
    const v = readKey(k);
    if (v !== undefined) data[k] = v;
  }
  const payload = { app: APP, version: VERSION, exportedAt: new Date().toISOString(), data };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `caelestia-backup-${new Date().toISOString().slice(0, 10)}${tag ? "-" + tag : ""}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatWhen(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t)
    ? "on an unknown date"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(t);
}

export async function readBackup(file) {
  if (file.size > MAX_BYTES) throw new Error("File is too large (2 MB maximum)");
  let obj;
  try { obj = JSON.parse(await file.text()); }
  catch { throw new Error("File is not valid JSON"); }

  if (!obj || obj.app !== APP || !obj.data || typeof obj.data !== "object" || Array.isArray(obj.data))
    throw new Error("This is not a backup file for this page");
  if (!Number.isInteger(obj.version) || obj.version > VERSION)
    throw new Error("This backup version is newer than the supported version");

  const sections = SECTIONS
    .filter((s) => CHECK[s.id](obj.data))
    .map((s) => ({ id: s.id, label: s.label, summary: SUMMARY[s.id](obj.data) }));
  if (!sections.length) throw new Error("Backup contains no recognized data");

  return { when: formatWhen(obj.exportedAt), data: obj.data, sections };
}

export function applyBackup(backup, chosenIds) {
  freezeSaves();
  for (const s of SECTIONS.filter((s) => chosenIds.includes(s.id))) {
    for (const k of s.keys) {
      const v = backup.data[k];
      if (v === undefined) continue;
      const out = k === "notes" ? String(v).slice(0, MAX_NOTES) : JSON.stringify(v);
      if (out.length > 1_500_000) continue;
      try { localStorage.setItem(k, out); } catch {}
    }
  }
  if (chosenIds.includes("notes")) {   // kalau tidak, penyimpanan otomatis catatan menimpa hasil impor saat halaman ditutup
    const ta = document.getElementById("note-area");
    if (ta) ta.value = String(backup.data.notes ?? "").slice(0, MAX_NOTES);
  }
  location.reload();   // modul memuat ulang datanya dan memeriksanya sendiri
}

export function resetAll() {
  freezeSaves();
  STORAGE_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  ["wallhue", "suncache"].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  const ta = document.getElementById("note-area");
  if (ta) ta.value = "";   // cegah penyimpanan otomatis catatan menulis ulang yang lama
  location.reload();
}