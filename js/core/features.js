import { emit, on, setState, state } from "./state.js";

const FEATURE_NAMES = {
  launcher: "Launcher",
  terminal: "Terminal",
  settings: "Settings",
  media: "Media player",
  performance: "Performance",
  workspaces: "Workspaces",
};

const loaders = {
  launcher: () => import("../ui/launcher.js"),
  terminal: () => import("../ui/terminal.js"),
  settings: () => import("../system/settings.js"),
  media: () => Promise.all([
    import("../ui/bars.js"),
    import("../music/mediactl.js"),
  ]),
  performance: () => import("../widgets/gauges.js"),
  workspaces: () => Promise.all([
    import("../ui/workspaces.js"),
    import("../system/shortcuts.js"),
    import("../widgets/notes.js"),
    import("../system/catalog.js"),
  ]),
};

const loaded = new Set();
const pending = new Map();

function reportLoadError(name, error) {
  console.error(`Failed to load ${FEATURE_NAMES[name]} feature:`, error);
  emit("toast", {
    title: `Could not load ${FEATURE_NAMES[name]}`,
    message: "Check your connection or reload the page, then try again.",
    type: "error",
    duration: 5000,
  });
}

function ensureFeature(name) {
  if (loaded.has(name)) return Promise.resolve(false);

  const existing = pending.get(name);
  if (existing) return existing.then(() => false);

  const task = loaders[name]()
    .then(() => {
      loaded.add(name);
      pending.delete(name);
      return true;
    })
    .catch((error) => {
      pending.delete(name);
      throw error;
    });

  pending.set(name, task);
  return task;
}

function loadForState(name, key) {
  on(`state:${key}`, (open) => {
    if (!open) return;

    ensureFeature(name)
      .then((newlyLoaded) => {
        if (newlyLoaded && state[key]) emit(`state:${key}`, true);
      })
      .catch((error) => {
        reportLoadError(name, error);
        setState(key, false);
      });
  });
}

loadForState("launcher", "launcher");
loadForState("terminal", "terminal");
loadForState("settings", "prefsOpen");
on("state:activeTab", (tab) => {
  const name = tab === "media"
    ? "media"
    : tab === "performance"
      ? "performance"
      : tab === "workspaces"
        ? "workspaces"
        : null;
  if (!name) return;

  ensureFeature(name)
    .then((newlyLoaded) => {
      if (newlyLoaded && state.activeTab === tab) emit("state:activeTab", tab);
    })
    .catch((error) => reportLoadError(name, error));
});

async function loadLibraryWindow() {
  try {
    return await import("../library/libwin.js");
  } catch (error) {
    console.error("Failed to load music library:", error);
    emit("toast", {
      title: "Could not load music",
      message: "Check your connection or reload the page, then try again.",
      type: "error",
      duration: 5000,
    });
    return null;
  }
}

export async function openLibrary(view) {
  const library = await loadLibraryWindow();
  library?.openLibrary(view);
}

export async function toggleLibrary() {
  const library = await loadLibraryWindow();
  library?.toggleLibrary();
}

document.getElementById("btn-launcher").addEventListener("click", () => {
  setState("launcher", !state.launcher);
});
document.getElementById("btn-terminal").addEventListener("click", () => {
  setState("terminal", !state.terminal);
});
document.getElementById("btn-settings").addEventListener("click", () => {
  setState("prefsOpen", !state.prefsOpen);
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || state.off || state.modal) return;

  const active = document.activeElement;
  const typing = active &&
    (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
  const modifier = event.ctrlKey || event.metaKey;

  if (modifier && event.key === ",") {
    event.preventDefault();
    setState("prefsOpen", !state.prefsOpen);
  } else if (modifier && event.key.toLowerCase() === "k") {
    event.preventDefault();
    setState("launcher", !state.launcher);
  } else if (event.key === "/" && !typing && !modifier && !event.altKey) {
    event.preventDefault();
    setState("launcher", true);
  } else if (event.key === "`" && !typing && !modifier && !event.altKey) {
    event.preventDefault();
    setState("terminal", !state.terminal);
  } else if (event.key.toLowerCase() === "m" && !typing && !modifier && !event.altKey) {
    event.preventDefault();
    toggleLibrary();
  }
});
