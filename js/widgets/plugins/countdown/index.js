import { LOCALE, zone } from "../../../core/state.js";
import { openDialog } from "../../../core/dialog.js";
import { every, todayStr, isDate, dayNum } from "../../runtime.js";

function mountCountdown(body, ctx) {
  const card = document.createElement("div");
  card.className = "cd";
  card.title = "Click to configure";
  body.append(card);

  let data = isDate(ctx.data?.date)
    ? { label: String(ctx.data.label ?? "").slice(0, 24) || "Countdown", date: ctx.data.date }
    : null;

  function render() {
    card.replaceChildren();
    if (!data) { card.textContent = "Click to set a date"; return; }
    const n = Math.round(dayNum(data.date) - dayNum(todayStr()));
    const num = document.createElement("div");
    num.className = "cd-num";
    const unit = document.createElement("div");
    unit.className = "cd-unit";
    if (n === 0) num.textContent = "Today!";
    else { num.textContent = String(Math.abs(n)); unit.textContent = n > 0 ? "days to go" : "days ago"; }
    const label = document.createElement("div");
    label.className = "cd-label";
    label.textContent = data.label;
    const date = document.createElement("div");
    date.className = "cd-date";
    date.textContent = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone: "UTC" })
      .format(new Date(data.date + "T00:00:00Z"));
    card.append(num, unit, label, date);
  }

  async function edit() {
    const v = await openDialog({
      title: "Countdown",
      fields: [
        { name: "label", label: "Event name", value: data?.label ?? "", maxlength: 24, placeholder: "Exam, birthday…" },
        { name: "date", label: "Date", type: "date", value: data?.date ?? "" },
      ],
      validate: (v) => (isDate(v.date) ? null : "Choose a valid date"),
    });
    if (!v) return;
    data = { label: v.label || "Countdown", date: v.date };
    ctx.save(data);
    render();
  }

  render();
  const stop = every(60_000, render);   // ganti hari otomatis
  if (ctx.isNew) edit();
  return { cleanup: stop, onTap: edit };
}

export { mountCountdown as default };
