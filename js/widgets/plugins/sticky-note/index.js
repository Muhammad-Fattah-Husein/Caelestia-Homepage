
const NOTE_COLORS = ["#fde68a", "#bbf7d0", "#fbcfe8", "#bfdbfe"];

const NOTE_NAMES = ["Yellow", "Green", "Pink", "Blue"];

function mountSticky(body, ctx) {
  const d = ctx.data ?? {};
  let c = Number.isInteger(d.c) && d.c >= 0 && d.c < NOTE_COLORS.length ? d.c : 0;

  const card = document.createElement("div");
  card.className = "sn";
  card.innerHTML = `<div class="sn-head"><span class="sn-dots"></span></div>
    <textarea class="sn-text" maxlength="1200" spellcheck="false" placeholder="Write something…" aria-label="Sticky note"></textarea>`;
  body.append(card);
  const ta = card.querySelector(".sn-text");
  const dots = card.querySelector(".sn-dots");
  ta.value = typeof d.text === "string" ? d.text.slice(0, 1200) : "";

  let timer = 0;
  const persist = () => { clearTimeout(timer); ctx.save({ text: ta.value, c }); };
  const paint = () => {
    card.style.setProperty("--note", NOTE_COLORS[c]);
    dots.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === c));
  };

  NOTE_COLORS.forEach((col, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = col;
    b.title = NOTE_NAMES[i];
    b.setAttribute("aria-label", `${NOTE_NAMES[i]} color`);
    b.addEventListener("click", () => { c = i; paint(); persist(); });
    dots.append(b);
  });

  ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(persist, 400); });
  ta.addEventListener("blur", persist);
  paint();
  return () => clearTimeout(timer);
}

export { mountSticky as default };
