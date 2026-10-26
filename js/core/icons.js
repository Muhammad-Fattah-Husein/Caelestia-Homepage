const ICON_FILES = new Set([
  "01_keyboard.png", "02_skip_next.png", "03_skip_previous.png", "04_stopwatch.png",
  "05_hourglass.png", "06_pause.png", "07_play.png", "08_sun.png", "09_cloud.png",
  "10_coffee.png", "11_heart.png", "12_settings.png", "13_warning.png",
  "14_partly_cloudy.png", "15_thunderstorm.png", "16_check.png", "17_sparkles.png",
  "18_snowflake.png", "19_globe.png", "20_last_quarter_moon.png",
  "21_crescent_moon.png", "22_sun_showers.png", "23_rain.png", "24_snow.png",
  "25_fog.png", "26_wind.png", "27_sprout.png", "28_tomato.png",
  "29_party_popper.png", "30_headphones.png", "31_game_controller.png",
  "32_target.png", "33_chat.png", "34_disc.png", "35_folder.png", "36_books.png",
  "37_note_edit.png", "38_newspaper.png", "39_search.png", "40_bell.png",
  "41_link.png", "42_fire.png", "43_clock.png", "44_image.png", "45_folders.png",
  "46_puzzle.png",
]);

const LEGACY_MODE_ICONS = new Map([
  ["2600-fe0f", "08_sun.png"],
  ["1f3af", "32_target.png"],
  ["1f327-fe0f", "23_rain.png"],
  ["1f319", "21_crescent_moon.png"],
  ["2744-fe0f", "18_snowflake.png"],
  ["2728", "17_sparkles.png"],
  ["1f4da", "36_books.png"],
  ["1f525", "42_fire.png"],
  ["1f33f", "27_sprout.png"],
  ["1f3a7", "30_headphones.png"],
  ["1f3ae", "31_game_controller.png"],
  ["2615", "10_coffee.png"],
]);

export function normalizeIcon(value, fallback = "46_puzzle.png") {
  if (ICON_FILES.has(value)) return value;
  const codepoints = Array.from(String(value ?? ""))
    .map((character) => character.codePointAt(0).toString(16))
    .join("-");
  return LEGACY_MODE_ICONS.get(codepoints) ?? fallback;
}

export function createIcon(file, className = "asset-icon", alt = "") {
  const img = document.createElement("img");
  img.className = className;
  img.src = new URL(`../../assets/transparent_ui_icons/${normalizeIcon(file)}`, import.meta.url).href;
  img.alt = alt;
  img.draggable = false;
  img.setAttribute("aria-hidden", alt ? "false" : "true");
  return img;
}
