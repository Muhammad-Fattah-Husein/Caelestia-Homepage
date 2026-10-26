import { on, emit } from "../core/state.js";

const moduleCache = new Map();
const styleCache = new Map();

const BUILT_INS = {
  disc: { folder: "disc", name: "Music disc", icon: "34_disc.png", listed: false },
  clock: { folder: "analog-clock", name: "Analog clock", icon: "43_clock.png", desc: "A clock with hands", listed: true },
  rain: { folder: "rain", name: "Rain", icon: "23_rain.png", desc: "Rain effect across the screen", listed: true, unique: true },
  snow: { folder: "snow", name: "Snow", icon: "18_snowflake.png", desc: "Falling snow effect", listed: true, unique: true },
  fireflies: { folder: "fireflies", name: "Fireflies", icon: "17_sparkles.png", desc: "Small drifting lights", listed: true, unique: true },
  pomodoro: { folder: "pomodoro", name: "Focus timer", icon: "28_tomato.png", desc: "25 minutes focused, 5 minutes break", listed: true, unique: true },
  countdown: { folder: "countdown", name: "Countdown", icon: "05_hourglass.png", desc: "Count down to a date", listed: true },
  checklist: { folder: "checklist", name: "Checklist", icon: "16_check.png", desc: "Up to 5 tasks, with confetti on completion", listed: true },
  quote: { folder: "quote", name: "Daily quote", icon: "33_chat.png", desc: "Changes each day", listed: true, unique: true },
  worldclock: { folder: "world-clock", name: "World clock", icon: "19_globe.png", desc: "Up to 3 time zones", listed: true },
  photo: { folder: "photo", name: "Photo frame", icon: "44_image.png", desc: "Photo from your device or a URL", listed: true, resize: "box", min: [120, 100] },
  sticky: { folder: "sticky-note", name: "Sticky note", icon: "37_note_edit.png", desc: "A small note in 4 colors", listed: true, resize: "box", min: [150, 130] },
  breath: { folder: "breathing-guide", name: "Breathing guide", icon: "26_wind.png", desc: "4-7-8, box, or calm breathing", listed: true, resize: "scale" },
  crypto: { folder: "crypto-prices", name: "Crypto prices", icon: "19_globe.png", desc: "Price and 24-hour change", listed: true, resize: "scale" },
  rss: { folder: "rss-reader", name: "RSS reader", icon: "38_newspaper.png", desc: "Latest headlines from one feed", listed: true, resize: "box", min: [200, 140] },
};

function loadStyles(type, manifestUrl, manifest) {
  if (styleCache.has(type)) return styleCache.get(type);
  const promise = Promise.all(manifest.styles.map((file) => new Promise((resolve, reject) => {
    const href = new URL(file, manifestUrl).href;
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find((link) => link.href === href);
    if (existing?.sheet) return resolve();
    const link = existing ?? document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.widgetStyle = type;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Could not load stylesheet: ${file}`));
    if (!existing) document.head.append(link);
  })));
  styleCache.set(type, promise);
  promise.catch(() => styleCache.delete(type));
  return promise;
}

function loadModule(type) {
  if (!moduleCache.has(type)) {
    const def = BUILT_INS[type];
    const manifestUrl = new URL(`./plugins/${def.folder}/manifest.json`, import.meta.url);
    const promise = fetch(manifestUrl).then((response) => {
      if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
      return response.json();
    }).then(async (manifest) => {
      if (manifest.type !== type || manifest.entry !== "index.js" || !Array.isArray(manifest.styles)) {
        throw new Error(`Invalid manifest for widget "${type}"`);
      }
      await loadStyles(type, manifestUrl, manifest);
      const moduleUrl = new URL(manifest.entry, manifestUrl);
      const module = await import(moduleUrl.href);
      if (typeof module.default !== "function") throw new Error(`Widget "${type}" has no default mount function`);
      return module.default;
    });
    moduleCache.set(type, promise);
    promise.catch(() => moduleCache.delete(type));
  }
  return moduleCache.get(type);
}

function lazyMount(type) {
  return (body, ctx) => {
    let disposed = false;
    let instance = null;
    body.textContent = "Loading widget…";
    loadModule(type).then((mount) => {
      if (disposed) return;
      body.replaceChildren();
      const result = mount(body, ctx);
      instance = typeof result === "function" ? { cleanup: result } : result ?? {};
    }).catch((error) => {
      if (disposed) return;
      console.error(`Failed to load widget "${type}":`, error);
      body.textContent = "Could not load widget";
      emit("toast", { title: `Could not load ${BUILT_INS[type].name}`, message: "Check the connection or reload the page.", type: "error" });
    });
    return {
      cleanup() {
        disposed = true;
        instance?.cleanup?.();
      },
      onTap() {
        instance?.onTap?.();
      },
    };
  };
}

export const DEFS = Object.fromEntries(Object.entries(BUILT_INS).map(([type, metadata]) => [
  type,
  { ...metadata, mount: lazyMount(type) },
]));

export { BUILT_INS };
