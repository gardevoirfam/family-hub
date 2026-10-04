// Weather for the home page, from Open-Meteo (free, no key needed).
// Times come back in Toronto time, which is also the iPad's time.

const PLACE = { name: 'Markham', latitude: 43.8561, longitude: -79.337 };
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: PLACE.latitude,
  longitude: PLACE.longitude,
  timezone: 'America/Toronto',
  forecast_days: '7',
  current: 'temperature_2m,apparent_temperature,weather_code',
  hourly: 'apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,rain_sum,showers_sum,snowfall_sum'
});

// Fetch again once the forecast is this old.
const MAX_AGE = 20 * 60 * 1000;
// How far ahead to look hour by hour for rain or snow.
const LOOKAHEAD_HOURS = 72;
// An hour counts as wet when rain or snow is this likely, or this much falls.
const WET_CHANCE = 40;
const WET_MM = 0.3;

let fetchedAt = 0;
let inFlight = null;

// Calls onData with a fresh forecast when the one held is old or missing.
// Failures keep the last forecast on screen.
export function loadWeather(onData) {
  if (inFlight || Date.now() - fetchedAt < MAX_AGE) return;
  inFlight = fetch(FORECAST_URL)
    .then(r => { if (!r.ok) throw new Error('weather ' + r.status); return r.json(); })
    .then(raw => { fetchedAt = Date.now(); onData(parseWeather(raw)); })
    .catch(err => console.warn(err))
    .finally(() => { inFlight = null; });
}

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const STORM_CODES = new Set([95, 96, 99]);
const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);

export function describe(code) {
  if (code === 0) return { icon: '☀️', text: 'Sunny' };
  if (code === 1) return { icon: '🌤️', text: 'Mostly sunny' };
  if (code === 2) return { icon: '⛅', text: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', text: 'Cloudy' };
  if (code === 45 || code === 48) return { icon: '🌫️', text: 'Foggy' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', text: 'Drizzle' };
  if (code === 66 || code === 67) return { icon: '🌧️', text: 'Freezing rain' };
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return { icon: '🌧️', text: 'Rain' };
  if (SNOW_CODES.has(code)) return { icon: '🌨️', text: 'Snow' };
  if (STORM_CODES.has(code)) return { icon: '⛈️', text: 'Thunderstorms' };
  return { icon: '🌡️', text: '' };
}

function kindOf(hasRain, hasSnow, hasStorm) {
  if (hasStorm) return 'Storms';
  if (hasRain && hasSnow) return 'Rain and snow';
  if (hasSnow) return 'Snow';
  return 'Rain';
}

// Groups the wet hours ahead into spells, joining spells split by one dry hour.
function wetSpells(hourly, now) {
  const spells = [];
  const until = now.getTime() + LOOKAHEAD_HOURS * 3600 * 1000;
  hourly.time.forEach((t, i) => {
    const start = new Date(t);
    const end = new Date(start.getTime() + 3600 * 1000);
    if (end <= now || start.getTime() > until) return;
    const code = hourly.weather_code[i];
    const chance = hourly.precipitation_probability[i] ?? 0;
    const mm = hourly.precipitation[i] ?? 0;
    if (chance < WET_CHANCE && mm < WET_MM) return;
    const snow = (hourly.snowfall[i] ?? 0) > 0 || SNOW_CODES.has(code);
    const storm = STORM_CODES.has(code);
    const last = spells[spells.length - 1];
    if (last && start - last.end <= 3600 * 1000) {
      last.end = end;
      last.chance = Math.max(last.chance, chance);
      last.snow ||= snow;
      last.rain ||= !snow;
      last.storm ||= storm;
    } else {
      spells.push({ start, end, chance, snow, rain: !snow, storm });
    }
  });
  return spells.map(s => ({ start: s.start, end: s.end, chance: s.chance, kind: kindOf(s.rain, s.snow, s.storm) }));
}

export function parseWeather(raw, now = new Date()) {
  const d = raw.daily;
  const days = d.time.map((t, i) => {
    const [y, m, day] = t.split('-').map(Number);
    const snow = (d.snowfall_sum[i] ?? 0) > 0 || SNOW_CODES.has(d.weather_code[i]);
    const rain = (d.rain_sum[i] ?? 0) + (d.showers_sum[i] ?? 0) > 0 || WET_CODES.has(d.weather_code[i]);
    return {
      date: new Date(y, m - 1, day),
      code: d.weather_code[i],
      high: Math.round(d.temperature_2m_max[i]),
      low: Math.round(d.temperature_2m_min[i]),
      chance: d.precipitation_probability_max[i] ?? 0,
      kind: rain || snow ? kindOf(rain, snow, STORM_CODES.has(d.weather_code[i])) : ''
    };
  });
  return {
    place: PLACE.name,
    now: {
      temp: Math.round(raw.current.temperature_2m),
      feels: Math.round(raw.current.apparent_temperature),
      code: raw.current.weather_code
    },
    days,
    hours: raw.hourly.time.map((t, i) => ({
      start: new Date(t),
      feels: raw.hourly.apparent_temperature[i],
      wet: (raw.hourly.precipitation_probability[i] ?? 0) >= WET_CHANCE || (raw.hourly.precipitation[i] ?? 0) >= WET_MM,
      snow: (raw.hourly.snowfall[i] ?? 0) > 0 || SNOW_CODES.has(raw.hourly.weather_code[i]),
      storm: STORM_CODES.has(raw.hourly.weather_code[i])
    })),
    spells: wetSpells(raw.hourly, now)
  };
}

// The part of the day the kids are out: 7 AM to 6 PM.
const OUT_FROM = 7;
const OUT_UNTIL = 18;

// What the kids should wear, from the coldest "feels like" temperature while
// they are out, plus rain or snow in that time. After 6 PM it plans for tomorrow.
export function outfit(weather, now = new Date()) {
  const tomorrow = now.getHours() >= OUT_UNTIL;
  const day = new Date(now);
  if (tomorrow) day.setDate(day.getDate() + 1);
  const from = new Date(day); from.setHours(OUT_FROM, 0, 0, 0);
  const until = new Date(day); until.setHours(OUT_UNTIL, 0, 0, 0);
  const start = tomorrow || now < from ? from : new Date(Math.floor(now / 3600e3) * 3600e3);
  const hours = (weather.hours || []).filter(h => h.start >= start && h.start < until && h.feels != null);
  if (!hours.length) return null;
  const temps = hours.map(h => h.feels);
  const low = Math.round(Math.min(...temps));
  const high = Math.round(Math.max(...temps));
  const wet = hours.filter(h => h.wet);
  const snow = wet.some(h => h.snow);
  const rain = wet.some(h => !h.snow);
  const storm = wet.some(h => h.storm);

  const items = [];
  let summary;
  if (low <= -10) {
    summary = 'Very cold';
    items.push(['👕', 'Long sleeve shirt'], ['👖', 'Long pants'], ['🧥', 'Winter coat'], ['👖', 'Snow pants'], ['🧣', 'Hat, mitts and scarf'], ['🥾', 'Winter boots']);
  } else if (low <= 0) {
    summary = 'Cold';
    items.push(['👕', 'Long sleeve shirt'], ['👖', 'Long pants'], ['🧥', 'Winter coat'], ['🧤', 'Hat and mitts']);
  } else if (low <= 8) {
    summary = 'Chilly';
    items.push(['👕', 'Long sleeve shirt'], ['👖', 'Long pants'], ['🧥', 'Warm jacket']);
    if (low <= 4) items.push(['🧢', 'Warm hat']);
  } else if (low <= 15) {
    summary = 'Cool';
    items.push(['👕', 'Long sleeve shirt'], ['👖', 'Long pants'], ['🧥', 'Light jacket or hoodie']);
  } else if (low <= 20) {
    summary = 'Mild';
    items.push(['👕', 'T-shirt'], ['👖', 'Long pants'], ['🧥', 'Bring a sweater']);
  } else {
    summary = high >= 28 ? 'Hot' : 'Warm';
    items.push(['👕', 'T-shirt'], ['🩳', 'Shorts are fine']);
    if (high >= 25) items.push(['🧴', 'Sunscreen and a hat'], ['💧', 'Water bottle']);
  }
  if (snow && low > -10) items.push(['🥾', 'Snow boots'], ...(low <= 0 ? [['👖', 'Snow pants']] : []));
  if (rain || storm) items.push(['☔', 'Raincoat or umbrella'], ...(snow ? [] : [['🥾', 'Rain boots']]));
  if (low > 0 && high - low >= 10) items.push(['🌡️', `Layers, it warms up to ${high}°`]);

  // Keep one of each, first wins (snow boots can come from two rules).
  const seen = new Set();
  return {
    when: tomorrow ? 'Tomorrow' : 'Today',
    summary, low, high, snow, rain: rain || storm,
    items: items.filter(([, text]) => !seen.has(text) && seen.add(text)).map(([icon, text]) => ({ icon, text }))
  };
}
