import { state, on, off, zone } from "../../../core/state.js";
import { every, todayStr, dayNum } from "../../runtime.js";

const QUOTES = [
  ["Little by little, a little becomes a lot.", "Proverb"],
  ["A journey of a thousand miles begins with a single step.", "Proverb"],
  ["Where there's a will, there's a way.", "Proverb"],
  ["Practice makes perfect.", "Proverb"],
  ["Still waters run deep.", "Proverb"],
  ["The fuller the rice grain, the lower it bends.", "Indonesian proverb"],
  ["United we stand, divided we fall.", "Proverb"],
  ["No one is perfect.", "Proverb"],
  ["Kill two birds with one stone.", "Proverb"],
  ["Better late than never.", "Proverb"],
  ["Practice makes difficult things easy.", "Proverb"],
  ["Never put off until tomorrow what you can do today.", "Proverb"],
];

function mountQuote(body) {
  const card = document.createElement("div");
  card.className = "qt";
  const text = document.createElement("div");
  text.className = "qt-text";
  const by = document.createElement("div");
  by.className = "qt-by";
  card.append(text, by);
  body.append(card);

  function pick() {   // satu kutipan per hari, berganti otomatis tengah malam
    const n = QUOTES.length;
    const [q, who] = QUOTES[((Math.floor(dayNum(todayStr())) % n) + n) % n];
    text.textContent = `“${q}”`;
    by.textContent = who;
  }
  pick();
  return every(5 * 60_000, pick);
}

export { mountQuote as default };
