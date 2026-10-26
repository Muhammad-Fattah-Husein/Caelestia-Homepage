import { state, emit } from "../../../core/state.js";
import { openDialog } from "../../../core/dialog.js";
import { createIcon } from "../../../core/icons.js";
import { isHttp } from "../../runtime.js";

const DB_NAME = "homepage-media", STORE = "blobs";

const openDb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); res(req?.result); };
    tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
  });
}

const putBlob = (k, b) => idb("readwrite", (s) => s.put(b, k));

const getBlob = (k) => idb("readonly", (s) => s.get(k));

const delBlob = (k) => idb("readwrite", (s) => s.delete(k));

const keysBlob = () => idb("readonly", (s) => s.getAllKeys());

async function shrink(file, max = 1280) {   // perkecil supaya hemat tempat
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), type, 0.85));
}

setTimeout(async () => {
  try {
    const keep = new Set(state.widgets.filter((widget) => widget.type === "photo").map((widget) => widget.id));
    for (const key of await keysBlob()) if (!keep.has(key)) await delBlob(key);
  } catch (error) {
    console.warn("Failed to clean up removed photo widgets:", error);
  }
}, 4000);

function mountPhoto(body, ctx) {
  const frame = document.createElement("div");
  frame.className = "pf";
  frame.innerHTML = `<img class="pf-img" alt="" draggable="false" referrerpolicy="no-referrer" hidden>
    <div class="pf-empty">Choose a photo using the buttons below</div>
    <div class="pf-bar">
      <button type="button" class="pf-file" title="Choose a photo from your device" aria-label="Choose a photo from your device"></button>
      <button type="button" class="pf-url" title="Use an image URL" aria-label="Use an image URL"></button>
    </div>
    <input class="pf-input" type="file" accept="image/*" hidden>`;
  body.append(frame);
  frame.querySelector(".pf-file").append(createIcon("35_folder.png"));
  frame.querySelector(".pf-url").append(createIcon("41_link.png"));
  const img = frame.querySelector(".pf-img");
  const empty = frame.querySelector(".pf-empty");
  const input = frame.querySelector(".pf-input");

  let src = typeof ctx.data?.src === "string" ? ctx.data.src : "";
  let objUrl = null;
  const revoke = () => { if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; } };

  function setImage(url) {
    img.onload = () => { img.hidden = false; empty.hidden = true; frame.classList.add("has"); };
    img.onerror = () => {
      img.hidden = true;
      empty.hidden = false;
      empty.textContent = "Could not load image";
      frame.classList.remove("has");
    };
    img.src = url;
  }

  async function restore() {
    if (src === "idb") {
      try {
        const blob = await getBlob(ctx.id);
        if (blob) { revoke(); objUrl = URL.createObjectURL(blob); return setImage(objUrl); }
      } catch {}
      src = "";
      empty.textContent = "Photo not found";
    } else if (isHttp(src, 1000)) setImage(src);
  }

  frame.querySelector(".pf-file").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    input.value = "";
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const blob = await shrink(f);
      await putBlob(ctx.id, blob);
      src = "idb";
      ctx.save({ src });
      revoke();
      objUrl = URL.createObjectURL(blob);
      setImage(objUrl);
    } catch (err) {
      console.warn("Failed to process photo:", err);
      emit("toast", { title: "Photo", message: "Could not process image", type: "error" });
    }
  });

  frame.querySelector(".pf-url").addEventListener("click", async () => {
    const v = await openDialog({
      title: "Image URL",
      fields: [{ name: "url", label: "Image URL", value: isHttp(src, 1000) ? src : "", placeholder: "https://…", maxlength: 600 }],
      validate: (v) => (isHttp(v.url, 600) ? null : "URL must start with http:// or https://"),
    });
    if (!v) return;
    if (src === "idb") delBlob(ctx.id).catch(() => {});
    src = v.url;
    ctx.save({ src });
    revoke();
    setImage(src);
  });

  restore();
  return () => {   // widget dihapus: bebaskan memori dan hapus foto tersimpan
    revoke();
    delBlob(ctx.id).catch(() => {});
  };
}

export { mountPhoto as default };
