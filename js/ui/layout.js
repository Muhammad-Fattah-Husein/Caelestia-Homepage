// Satu sumber untuk "berapa ruang yang dimakan bar dan bingkai".
// Batas 600px harus sama dengan @media (max-width: 600px) di css/phone.css.
const phone = matchMedia("(max-width: 600px)");

const PHONE = { left: 10, top: 10, right: 10, bottom: 58 };   // bar pindah ke bawah (48px) + 10px
const WIDE  = { left: 58, top: 10, right: 10, bottom: 10 };   // bar di kiri (48px) + 10px

export const isPhone = () => phone.matches;
export const inset = () => (phone.matches ? PHONE : WIDE);
export const onLayoutChange = (fn) => phone.addEventListener("change", fn);