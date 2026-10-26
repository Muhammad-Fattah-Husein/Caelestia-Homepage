import { state, on, off, zone } from "../../../core/state.js";
import { openDialog } from "../../../core/dialog.js";
import { every, todayStr, ymd } from "../../runtime.js";

const ZONES = [
  "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul",
  "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Moscow", "Africa/Cairo", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "America/Sao_Paulo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

const isZone = (z) => { try { new Intl.DateTimeFormat("en-GB", { timeZone: z }); return true; } catch { return false; } };

const city = (z) => z.split("/").pop().replaceAll("_", " ");

function mountWorld(body, ctx) {
  let zones = Array.isArray(ctx.data?.zones)
    ? ctx.data.zones.filter((z) => typeof z === "string" && isZone(z)).slice(0, 3)
    : [];
  if (!zones.length) zones = [zone, "Asia/Tokyo", "Europe/London"];

  const card = document.createElement("div");
  card.className = "wcl";
  card.title = "Click to change time zones";
  body.append(card);

  function render() {
    const now = new Date();
    const today = todayStr();
    card.replaceChildren(...zones.map((z) => {
      const row = document.createElement("div");
      row.className = "wcl-row";
      const name = document.createElement("span");
      name.className = "wcl-city";
      name.textContent = city(z);
      const time = document.createElement("span");
      time.className = "wcl-time";
      time.textContent = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: z,
      }).format(now);
      const day = ymd(z).format(now);
      if (day !== today) {
        const tag = document.createElement("span");
        tag.className = "wcl-tag";
        tag.textContent = day > today ? "tomorrow" : "yesterday";
        time.append(tag);
      }
      row.append(name, time);
      return row;
    }));
  }

  async function edit() {
    const options = [...new Set([zone, ...ZONES])].map((z) => [z, city(z)]);
    const v = await openDialog({
      title: "World clock",
      fields: [0, 1, 2].map((i) => ({
        name: `z${i}`, label: `Time zone ${i + 1}`, type: "select",
        options: i === 0 ? options : [["", "(none)"], ...options],
        value: zones[i] ?? "",
      })),
      validate: (v) => (v.z0 ? null : "Time zone 1 is required"),
    });
    if (!v) return;
    zones = [v.z0, v.z1, v.z2].filter((z) => z && isZone(z));
    ctx.save({ zones });
    render();
  }

  render();
  return { cleanup: every(15_000, render), onTap: edit };
}

export { mountWorld as default };
