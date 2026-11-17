// How hot the air feels: the US National Weather Service heat index, from air temperature and relative humidity.
// Used for the `air` kind (CONTRACT.md: temp_c, humidity_pct). The limits it is compared with are in
// shared/limits.json (air_heat_warn_c, air_heat_danger_c); this file only holds the published formula.
//
// Source: US National Weather Service, "What is the heat index?" https://www.weather.gov/ama/heatindex
//   Heat Index = -42.379 + 2.04901523*T + 10.14333127*RH - .22475541*T*RH - .00683783*T*T - .05481717*RH*RH
//                + .00122874*T*T*RH + .00085282*T*RH*RH - .00000199*T*T*RH*RH
//   T = air temperature in Fahrenheit, RH = relative humidity in percent. The NWS states an error of +/- 1.3 F.
//
// The NWS chart starts at 80 F: below that the heat index is not defined and the air temperature itself is used.
const CHART_STARTS_F = 80;
const toF = (c) => (c * 9) / 5 + 32;
const toC = (f) => ((f - 32) * 5) / 9;
const isNum = (x) => typeof x === "number" && !Number.isNaN(x);

function heatIndexF(tF, rh) {
  return -42.379 + 2.04901523 * tF + 10.14333127 * rh - 0.22475541 * tF * rh - 0.00683783 * tF * tF - 0.05481717 * rh * rh +
    0.00122874 * tF * tF * rh + 0.00085282 * tF * rh * rh - 0.00000199 * tF * tF * rh * rh;
}

// What to compare with the heat limits. Returns null when there is no temperature.
//   { c, label, detail }   c = degrees C (one decimal), label = what the number is, detail = how it was worked out
function feelsLike(temp_c, humidity_pct) {
  if (!isNum(temp_c)) return null;
  const tF = toF(temp_c);
  if (!isNum(humidity_pct))
    return { c: temp_c, label: "air temperature", detail: `air ${temp_c} C, no humidity reading, so humidity is not counted` };
  const rh = Math.min(100, Math.max(0, humidity_pct));
  if (tF < CHART_STARTS_F)
    return { c: temp_c, label: "air temperature", detail: `air ${temp_c} C at ${humidity_pct} % humidity, below the range of the heat index` };
  // the index is never taken as cooler than the air itself (the formula dips slightly below it in very dry air)
  const c = +Math.max(temp_c, toC(heatIndexF(tF, rh))).toFixed(1);
  return { c, label: "heat index", detail: `air ${temp_c} C at ${humidity_pct} % humidity` };
}

module.exports = { feelsLike, heatIndexF, toF, toC };
