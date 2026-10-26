import { emit, state, on } from "../core/state.js";

// Kode cuaca WMO -> [berkas ikon, teks]. Dipakai juga oleh dashboard.js
export function describe(code, isDay) {
  if (code === 0)  return [isDay ? "08_sun.png" : "21_crescent_moon.png", "Clear"];
  if (code <= 2)   return [isDay ? "14_partly_cloudy.png" : "09_cloud.png", "Partly cloudy"];
  if (code === 3)  return ["09_cloud.png", "Overcast"];
  if (code <= 48)  return ["25_fog.png", "Fog"];
  if (code <= 57)  return ["22_sun_showers.png", "Drizzle"];
  if (code <= 67)  return ["23_rain.png", "Rain"];
  if (code <= 77)  return ["18_snowflake.png", "Snow"];
  if (code <= 82)  return ["23_rain.png", "Rain showers"];
  if (code <= 86)  return ["24_snow.png", "Snow showers"];
  return ["15_thunderstorm.png", "Thunderstorm"];
}
const FALLBACK = { lat: -6.2, lon: 106.8167 };   // Jakarta

function getCoords() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(FALLBACK);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(FALLBACK),                       // ditolak / gagal
      { timeout: 5000, maximumAge: 3_600_000 }       // cache lokasi 1 jam
    );
  });
}

async function fetchWeather({ lat, lon }) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lat}&longitude=${lon}`
    + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,wind_speed_10m"
    + "&hourly=temperature_2m,weather_code,is_day,precipitation_probability,relative_humidity_2m,apparent_temperature,wind_speed_10m"
    + "&daily=sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
    + "&wind_speed_unit=ms&forecast_days=7&timezone=auto";
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}
function sunTimes(d) {
  const off = (d.utc_offset_seconds ?? 0) * 1000;
  const toEpoch = (s) => Date.parse(s + "Z") - off;   // waktu setempat dibaca sebagai UTC, lalu dikoreksi selisih zona
  return { rise: d.daily.sunrise.map(toEpoch), set: d.daily.sunset.map(toEpoch) };
}

let last = null;
export const lastWeather = () => last;   // dashboard.js membaca ini kalau datanya sudah tiba sebelum ia siap

async function update() {
  if (state.off) return;
  try {
    const data = await fetchWeather(await getCoords());
    last = data;
    emit("weather:updated", data.current);
    emit("weather:data", data);   // seluruh data: current, hourly, daily
    try { emit("sun:data", sunTimes(data)); } catch {}   // data matahari boleh gagal tanpa merusak tampilan cuaca
  } catch (err) {
    console.warn("Failed to load weather:", err);
    emit("weather:error", err);
  }
}

on("power:on", update);
update();
setInterval(update, 15 * 60 * 1000);   // tiap 15 menit