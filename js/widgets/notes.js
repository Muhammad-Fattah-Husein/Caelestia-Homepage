const KEY = "notes";
const area = document.getElementById("note-area");
const status = document.getElementById("note-status");
let timer;

try { area.value = localStorage.getItem(KEY) ?? ""; } catch {}

function save() {
  try {
    localStorage.setItem(KEY, area.value);
    status.textContent = "Saved";
  } catch {
    status.textContent = "Could not save (storage is full or disabled)";
  }
}

area.addEventListener("input", () => {
  status.textContent = "Saving…";
  clearTimeout(timer);
  timer = setTimeout(save, 500);   // simpan setelah berhenti mengetik setengah detik
});

window.addEventListener("pagehide", () => { clearTimeout(timer); save(); });   // jangan hilang kalau tab ditutup mendadak