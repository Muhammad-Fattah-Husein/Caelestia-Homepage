import { state, setState, on, emit, zone, LOCALE } from "../core/state.js";
import { WORKSPACES } from "./workspaces.js";
import { THEMES, setTheme } from "../system/theme.js";
import { MODES, applyMode } from "../ux/modes.js";
import { calcLine, parseTimer } from "../system/smart.js";
import { startTimer, cancelTimers, listTimers, human, fmtClock } from "../widgets/timer.js";

const root = document.getElementById("terminal");
const out = document.getElementById("term-out");
const input = document.getElementById("term-input");
const PROMPT = "~ ❯";
const MAX_LINES = 300;

// ---- riwayat perintah (tersimpan di browser ini) ----
const HIST_KEY = "termhist";
const HIST_MAX = 50;

function loadHist() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIST_KEY));
    return Array.isArray(raw)
      ? raw.filter((x) => typeof x === "string").slice(-HIST_MAX)
      : [];
  } catch {
    return [];
  }
}
function saveHist() {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(history));
  } catch {}
}

const history = loadHist();
let hi = history.length;   // posisi saat menelusuri riwayat dengan panah
let draft = "";            // ketikan yang belum dikirim, dipulihkan saat panah bawah mentok

function print(text = "", cls = "") {
  const d = document.createElement("div");
  d.className = "tl " + cls;
  d.textContent = text;
  out.append(d);
  while (out.children.length > MAX_LINES) out.firstChild.remove();
  out.scrollTop = out.scrollHeight;
}

function row(label, value, pad = 10) {
  const d = document.createElement("div");
  d.className = "tl";
  const l = document.createElement("span");
  l.className = "lbl";
  l.textContent = label.padEnd(pad);
  d.append(l, value);
  out.append(d);
  out.scrollTop = out.scrollHeight;
}

// logo sementara: huruf "C". Ganti isi larik ini kapan saja, tata letaknya tidak ikut berubah.
const LOGO = [
  "         :=+X%%%%%%X+=:",
  "      -X%$$&&&&&&&&&&$$%X-",
  "    =%$&&@&&&&$$$$&&&&@&&$%=",
  "  :#$&&@&$$%X==::==X%$$&@&%=.",
  " -%$&@&$%X:          :X%X-",
  ".%$&@&$#:",
  "+$&@&$%:",
  "%$&@&$X",
  "%$&@&$X",
  "+$&@&$%:",
  ".%$&@&$#:",
  " -%$&@&$%X:          :X%X-",
  "  :#$&&@&$$%X==::==X%$$&@&%=.",
  "    =%$&&@&&&&$$$$&&&&@&&$%=",
  "      -X%$$&&&&&&&&&&$$%X-",
  "         :=+X%%%%%%X+=:",
];

// satu blok dua kolom: keterangan (55%) di kiri, logo (45%) di kanan
function fetchBlock(rows) {
  const box = document.createElement("div");
  box.className = "ff";

  const info = document.createElement("div");
  info.className = "ff-info";
  for (const [label, value] of rows) {
    const d = document.createElement("div");
    d.className = "tl";
    const l = document.createElement("span");
    l.className = "lbl";
    l.textContent = label.padEnd(10);
    d.append(l, value);
    info.append(d);
  }

  const logo = document.createElement("pre");
  logo.className = "ff-logo";
  logo.setAttribute("aria-hidden", "true");
  logo.textContent = LOGO.join("\n");

  box.append(logo, info);
  out.append(box);
  out.scrollTop = out.scrollHeight;
}

const audio = document.getElementById("audio");
const allLinks = () => state.shortcuts;

const COMMANDS = {
  help() {
    [
      ["help", "list commands"],
      ["fastfetch", "browser and page information"],
      ["themes", "list themes"],
      ["theme <name|number>", "change theme"],
      ["mode [name]", "change mode"],
      ["ws", "list workspaces"],
      ["shortcuts", "list shortcuts"],
      ["open <name>", "open a shortcut"],
      ["play | pause | next | prev", "music controls"],
      ["toast <message>", "test a notification"],
      ["date", "current date and time"],
      ["calc <expression>", "calculate or convert, e.g. calc 5 km to mi"],
      ["timer <duration>|cancel", "e.g. timer 10 min tea"],
      ["history [clear]", "command history"],
      ["clear", "clear the terminal"],
      ["exit", "close the terminal"],
      ["Tab", "complete a command or argument"],
      ["→ or End", "accept a history suggestion"],
    ].forEach(([c, d]) => row(c, d, 28));
  },

  fastfetch() {
    const brands = navigator.userAgentData?.brands
      ?.filter((b) => !/not.?a.?brand/i.test(b.brand))
      .map((b) => b.brand);
    const mins = Math.floor(performance.now() / 60000);
    const rows = [
      ["user", "guest@caelestia"],
      [
        "os",
        navigator.userAgentData?.platform ||
          navigator.platform ||
          "unknown",
      ],
      ["browser", brands?.length ? brands.join(" / ") : "unknown"],
      ["display", `${screen.width}×${screen.height} @${devicePixelRatio}x`],
      [
        "cpu",
        navigator.hardwareConcurrency
          ? `${navigator.hardwareConcurrency} thread`
          : "unknown",
      ],
      ...(navigator.deviceMemory
        ? [["ram", `~${navigator.deviceMemory} GB`]]
        : []),
      ["language", navigator.language],
      ["time zone", zone],
      [
        "uptime",
        (mins < 60
          ? `${mins} min`
          : `${Math.floor(mins / 60)} hr ${mins % 60} min`) +
          " (this page)",
      ],
      ["theme", THEMES[state.theme].name],
      ["workspace", WORKSPACES[state.workspace].name],
    ];
fetchBlock(rows);
  },

  themes() {
    THEMES.forEach((t, i) =>
      print(`${i === state.theme ? "*" : " "} ${i + 1}. ${t.name}`),
    );
  },

  theme(args) {
    const q = args.join(" ").toLowerCase();
    if (!q) return print("Usage: theme <name|number>", "err");
    const i = /^\d+$/.test(q)
      ? Number(q) - 1
      : THEMES.findIndex((t) => t.name.toLowerCase() === q);
    if (!THEMES[i]) return print(`Theme not found: ${q}`, "err");
    setTheme(i);
    print(`Theme changed to ${THEMES[i].name}`, "ok");
  },

  mode(args) {
    const id = args.join(" ").toLowerCase();
    if (!id)
      return MODES.forEach((m) =>
        print(`${m.id === state.mode ? "*" : " "} ${m.name}`),
      );
    if (applyMode(id)) print(`Mode: ${id}`, "ok");
    else print(`Mode not found: ${id}`, "err");
  },

  ws() {
    WORKSPACES.forEach((w, i) =>
      print(`${i === state.workspace ? "*" : " "} ${i + 1}. ${w.name}`),
    );
  },
  shortcuts() {
    if (!state.shortcuts.length) return print("No shortcuts yet");
    state.shortcuts.forEach((s) => print(`${s.name}: ${s.url}`));
  },

  open(args) {
    const q = args.join(" ").toLowerCase();
    if (!q) return print("Usage: open <shortcut name>", "err");
    const link =
      allLinks().find((l) => l.name.toLowerCase() === q) ??
      allLinks().find((l) => l.name.toLowerCase().includes(q));
    if (!link) return print(`Shortcut not found: ${q}`, "err");
    window.open(link.url, "_blank", "noopener,noreferrer");
    print(`Opening ${link.name}…`, "ok");
  },

  play() {
    audio
      .play()
      .catch(() => print("Blocked by browser: click the page first", "err"));
  },
  pause() {
    audio.pause();
  },
  next() {
    document.getElementById("btn-next").click();
  },
  prev() {
    document.getElementById("btn-prev").click();
  },

  toast(args) {
    emit("toast", {
      title: "Terminal",
      message: args.join(" ") || "Hello from the terminal",
    });
  },
  echo(args) {
    print(args.join(" "));
  },
  date() {
    print(
      new Intl.DateTimeFormat(LOCALE, {
        dateStyle: "full",
        timeStyle: "medium",
        timeZone: zone,
      }).format(new Date()),
    );
  },
  history(args) {
    if (args[0] === "clear") {
      history.length = 0;
      hi = 0;
      saveHist();
      return print("History cleared", "ok");
    }
    if (!history.length) return print("History is empty");
    history.forEach((h, i) => print(`${String(i + 1).padStart(3)}  ${h}`));
  },
  calc(args) {
    const q = args.join(" ");
    if (!q) return print("Usage: calc <expression>  e.g. calc 15% of 200 · calc 5 km to mi", "err");
    const line = calcLine(q);
    if (line) print(line, "ok");
    else print(`Could not calculate: ${q}`, "err");
  },
  timer(args) {
    const q = args.join(" ").trim();
    if (!q) {   // tanpa argumen: daftar timer aktif
      const list = listTimers();
      if (!list.length) return print("No active timers");
      return list.forEach((t) => print(`${fmtClock(t.left)}  ${t.label || human(t.secs)}`));
    }
    if (/^(cancel|stop)$/i.test(q)) return cancelTimers();
    const t = parseTimer("timer " + q);
    if (!t) return print("Usage: timer <duration> [label]  e.g. timer 10 min · timer 1 hr 30 min tea", "err");
    startTimer(t.secs, t.label);
    print(`Timer started: ${human(t.secs)}${t.label ? " · " + t.label : ""}`, "ok");
  },
  clear() {
    out.replaceChildren();
  },
  exit() {
    setState("terminal", false);
  },
};

const ALIAS = { neofetch: "fastfetch", cls: "clear", quit: "exit" };
const resolve = (name) => (Object.hasOwn(ALIAS, name) ? ALIAS[name] : name);

// ---- pelengkapan otomatis (Tab) ----
// daftar argumen yang bisa dilengkapi untuk tiap perintah
const ARGS = {
  theme: () => THEMES.map((t) => t.name.toLowerCase()),
  mode: () => MODES.map((m) => m.name.toLowerCase()),
  open: () => allLinks().map((l) => l.name.toLowerCase()),
  history: () => ["clear"],
  timer: () => ["cancel"],
};

function commonPrefix(list) {
  let p = list[0];
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

// hasil: { value, options } atau null kalau tidak ada yang cocok
function complete(raw) {
  const value = raw.replace(/^\s+/, "");
  const sp = value.search(/\s/);
  let head = "", part = value, pool = Object.keys(COMMANDS);
  if (sp >= 0) {
    const cmd = value.slice(0, sp);
    head = cmd + " ";
    part = value.slice(sp).trimStart();
    pool = ARGS[resolve(cmd)]?.() ?? [];
  }
  const matches = pool
    .filter((p) => p.toLowerCase().startsWith(part.toLowerCase()))
    .sort();
  if (!matches.length) return null;
  const done =
    matches.length === 1
      ? matches[0] + (sp < 0 ? " " : "")   // perintah lengkap diberi spasi, argumen tidak
      : commonPrefix(matches);
  return { value: head + done, options: matches.length > 1 ? matches : [] };
}

function run(line) {
  print(`${PROMPT} ${line}`, "cmd");
  const [name, ...args] = line.split(/\s+/);
  const key = resolve(name);
  if (!Object.hasOwn(COMMANDS, key))
    return print(`Command not found: ${name}. Type "help".`, "err");
  try {
    COMMANDS[key](args);
  } catch (e) {
    print(`error: ${e.message}`, "err");
  }
}

// ---- saran dari riwayat saat mengetik (teks pudar, diterima dengan → atau End) ----
const field = input.parentElement;
if (getComputedStyle(field).position === "static") field.style.position = "relative";
const ghost = document.createElement("span");
ghost.setAttribute("aria-hidden", "true");
ghost.style.cssText =
  "position:absolute;display:none;align-items:center;pointer-events:none;white-space:pre;overflow:hidden;opacity:.4";
const ghostTyped = document.createElement("span");
ghostTyped.style.visibility = "hidden";   // bagian yang sudah diketik: tak terlihat, teks aslinya dari input di bawahnya
const ghostRest = document.createElement("span");
ghost.append(ghostTyped, ghostRest);
field.append(ghost);

function suggestion() {
  const v = input.value;
  if (!v || input.selectionStart !== v.length || input.selectionEnd !== v.length) return "";   // hanya saat kursor di ujung
  const lv = v.toLowerCase();
  for (let i = history.length - 1; i >= 0; i--) {   // yang terbaru didahulukan
    const h = history[i];
    if (h.length > v.length && h.toLowerCase().startsWith(lv)) return h.slice(v.length);
  }
  return "";
}

function updateGhost() {
  const rest = suggestion();
  if (!rest) {
    ghost.style.display = "none";
    return;
  }
  const cs = getComputedStyle(input);
  Object.assign(ghost.style, {
    display: "flex",
    left: input.offsetLeft + "px",
    top: input.offsetTop + "px",
    width: input.offsetWidth + "px",
    height: input.offsetHeight + "px",
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    letterSpacing: cs.letterSpacing,
    color: cs.color,
    paddingLeft: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + "px",
    paddingRight: parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth) + "px",
  });
  ghostTyped.textContent = input.value;
  ghostRest.textContent = rest;
}

function acceptSuggestion() {
  const rest = suggestion();
  if (!rest) return false;
  input.value += rest;
  updateGhost();
  return true;
}

for (const ev of ["input", "keyup", "click", "focus"]) input.addEventListener(ev, updateGhost);
input.addEventListener("keydown", (e) => {
  if ((e.key === "ArrowRight" || e.key === "End") && acceptSuggestion()) e.preventDefault();
});

input.addEventListener("keydown", (e) => {
  queueMicrotask(updateGhost);   // nilai bisa berubah oleh Enter, panah, atau Tab di bawah
  if (e.key === "Enter") {
    const line = input.value.trim();
    input.value = "";
    draft = "";
    if (!line) return;
    if (history.at(-1) !== line) {   // perintah sama berturut-turut dicatat sekali
      history.push(line);
      if (history.length > HIST_MAX) history.shift();
      saveHist();
    }
    hi = history.length;
    run(line);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (hi === history.length) draft = input.value;
    hi = Math.max(hi - 1, 0);
    input.value = history[hi] ?? "";
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    hi = Math.min(hi + 1, history.length);
    input.value = hi === history.length ? draft : (history[hi] ?? "");
  } else if (e.key === "Tab") {
    e.preventDefault();   // fokus tetap di terminal
    const before = input.value;
    const r = complete(before);
    if (!r) {
      acceptSuggestion();   // tak ada yang bisa dilengkapi: Tab menerima saran riwayat (berguna di HP)
      return;
    }
    input.value = r.value;
    // tidak ada yang bisa ditambahkan lagi tapi masih banyak pilihan: tampilkan daftarnya
    if (r.options.length && r.value.trim() === before.trim())
      print(r.options.join("  "));
  } else if (e.key === "`") {
    e.preventDefault();
    setState("terminal", false);
  }
});

let greeted = false;
on("state:terminal", (open) => {
  root.classList.toggle("open", open);
  root.inert = !open;
  if (open) {
    if (!greeted) {
      greeted = true;
      COMMANDS.fastfetch();
      print(" ");
      print('Type "help" to list commands.');
    }
    input.focus();
  } else input.blur();
});

root.addEventListener("click", () => {
  if (!getSelection().toString()) input.focus(); // jangan ganggu kalau user sedang menyeleksi teks
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setState("terminal", false);
});