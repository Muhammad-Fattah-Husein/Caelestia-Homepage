// Indonesian national holidays.
// Sources: Joint Ministerial Decrees No. 1497/2025 (2026) and No. 1205/2026 (2027).
// L = national holiday, C = collective leave. Dates for Eid al-Fitr, Eid al-Adha, and 1 Ramadan
// are set by the Ministry of Religious Affairs and may differ by a day from the dates listed here.
// Add each year's block when its decree is published (usually the previous September).
const DATA = {
  2026: [
    ["01-01", "L", "New Year's Day 2026"],
    ["01-16", "L", "Isra and Mi'raj (Prophet Muhammad)"],
    ["02-16", "C", "Chinese New Year collective leave"],
    ["02-17", "L", "Chinese New Year 2577 (Kongzili)"],
    ["03-18", "C", "Nyepi collective leave"],
    ["03-19", "L", "Nyepi (Saka 1948)"],
    ["03-20", "C", "Eid al-Fitr collective leave"],
    ["03-21", "L", "Eid al-Fitr 1447 AH"],
    ["03-22", "L", "Eid al-Fitr 1447 AH"],
    ["03-23", "C", "Eid al-Fitr collective leave"],
    ["03-24", "C", "Eid al-Fitr collective leave"],
    ["04-03", "L", "Good Friday"],
    ["04-05", "L", "Easter Sunday"],
    ["05-01", "L", "International Workers' Day"],
    ["05-14", "L", "Ascension Day"],
    ["05-15", "C", "Ascension Day collective leave"],
    ["05-27", "L", "Eid al-Adha 1447 AH"],
    ["05-28", "C", "Eid al-Adha collective leave"],
    ["05-31", "L", "Vesak Day 2570 BE"],
    ["06-01", "L", "Pancasila Day"],
    ["06-16", "L", "Islamic New Year 1448 AH"],
    ["08-17", "L", "Indonesian Independence Day"],
    ["08-25", "L", "The Prophet Muhammad's Birthday"],
    ["12-24", "C", "Christmas collective leave"],
    ["12-25", "L", "Christmas Day"],
  ],
  2027: [
    ["01-01", "L", "New Year's Day 2027"],
    ["01-05", "L", "Isra and Mi'raj (Prophet Muhammad)"],
    ["02-05", "C", "Chinese New Year collective leave"],
    ["02-06", "L", "Chinese New Year 2578 (Kongzili)"],
    ["03-08", "L", "Nyepi (Saka 1949)"],
    ["03-09", "C", "Eid al-Fitr collective leave"],
    ["03-10", "L", "Eid al-Fitr 1448 AH"],
    ["03-11", "L", "Eid al-Fitr 1448 AH"],
    ["03-12", "C", "Eid al-Fitr collective leave"],
    ["03-15", "C", "Eid al-Fitr collective leave"],
    ["03-25", "C", "Good Friday collective leave"],
    ["03-26", "L", "Good Friday"],
    ["03-28", "L", "Easter Sunday"],
    ["05-01", "L", "International Workers' Day"],
    ["05-06", "L", "Ascension Day"],
    ["05-17", "L", "Eid al-Adha 1448 AH"],
    ["05-18", "C", "Eid al-Adha collective leave"],
    ["05-19", "C", "Vesak collective leave"],
    ["05-20", "L", "Vesak Day 2571 BE"],
    ["06-01", "L", "Pancasila Day"],
    ["06-06", "L", "Islamic New Year 1449 AH"],
    ["08-15", "L", "The Prophet Muhammad's Birthday"],
    ["08-17", "L", "Indonesian Independence Day"],
    ["12-24", "C", "Christmas collective leave"],
    ["12-25", "L", "Christmas Day"],
    ["12-26", "L", "Isra and Mi'raj (Prophet Muhammad)"],
  ],
};

// tahun yang belum ada datanya: hanya hari libur bertanggal tetap yang ditampilkan
const FIXED = [
  ["01-01", "New Year's Day"],
  ["05-01", "International Workers' Day"],
  ["06-01", "Pancasila Day"],
  ["08-17", "Indonesian Independence Day"],
  ["12-25", "Christmas Day"],
];

const index = new Map();   // "YYYY-MM-DD" -> [{ type, name }]
for (const [year, list] of Object.entries(DATA)) {
  for (const [md, type, name] of list) {
    const key = `${year}-${md}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ type, name });
  }
}

export const holidayYearKnown = (y) => Object.hasOwn(DATA, y);

// m: 0-11 (sama seperti Date). Hasil: [{ type: "L" | "C", name }]
export function holidaysOn(y, m, d) {
  const md = `${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (holidayYearKnown(y)) return index.get(`${y}-${md}`) ?? [];
  const f = FIXED.find(([x]) => x === md);
  return f ? [{ type: "L", name: f[1] }] : [];
}