const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dayKey(d = new Date()) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

// True for a job with a start date whose window (start to due) covers today.
export function inWindow(task, dayStart, dayEnd) {
  return !!(task.start && task.due && task.start < dayEnd && task.due >= dayStart);
}

export const fmt = {
  longDate: d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  dayDate: d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
  shortDate: d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  weekday: d => d.toLocaleDateString('en-US', { weekday: 'short' }),
  time: d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
};

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
