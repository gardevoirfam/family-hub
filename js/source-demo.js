// Sample data for previewing the UI without signing in: open index.html?demo
// Nothing here touches Firebase.
import { startOfDay, addDays, dayKey } from './dates.js';
import { hashPin } from './pin.js';
import { cleanDigest } from './digest.js';

const at = (dayOffset, h, m = 0) => {
  const d = addDays(startOfDay(), dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
};
const fmtDay = n => at(n, 0).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const people = [
  { id: 'maya', name: 'Maya', order: 1, points: 140, streak: 4 },
  { id: 'leo', name: 'Leo', order: 2, points: 85, streak: 6 },
  { id: 'mom', name: 'Mom', order: 3, points: 60, streak: 2 },
  { id: 'dad', name: 'Dad', order: 4, points: 45, streak: 5 }
];

const events = [
  { id: 'e1', title: 'Soccer game', place: 'Riverside Park, field 2', notes: 'Shin guards, cleats and a water bottle.', start: at(0, 10), who: ['leo', 'dad'] },
  { id: 'e2', title: "Jenna's birthday party", place: 'Jump Zone, 123 Main St', notes: 'Bring the wrapped present.\nEveryone jumping needs grip socks.', start: at(0, 14), who: ['maya', 'mom'] },
  { id: 'e3', title: "Dinner at Grandma's", place: 'Leave by 4:30', start: at(1, 17), who: [] },
  { id: 'e4', title: 'Piano lesson', place: 'Bring the blue book', start: at(2, 16, 30), who: ['maya'] },
  { id: 'e5', title: 'School picture day', place: 'Wear something nice', start: at(3, 0), allDay: true, who: ['maya', 'leo'] },
  { id: 'e6', title: 'Dentist checkup', place: 'Dr. Patel', start: at(5, 15, 15), who: ['leo', 'mom'] }
];

const tasks = [
  { id: 't1', personId: 'maya', title: 'Feed the cat', due: at(0, 8), points: 5, done: true, doneAt: at(0, 7, 50) },
  { id: 't2', personId: 'maya', title: 'Unload the dishwasher', due: at(0, 17), points: 10, done: false },
  { id: 't3', personId: 'maya', title: 'Return library books', due: at(-1, 17), points: 10, done: false },
  { id: 't6', personId: 'leo', title: 'Make your bed', due: at(0, 9), points: 5, done: true, doneAt: at(0, 8, 30) },
  { id: 't7', personId: 'leo', title: 'Water the plants', due: at(0, 16), points: 5, done: false },
  { id: 't8', personId: 'leo', title: 'Put toys away', due: at(0, 19), points: 5, done: false },
  { id: 't9', personId: 'leo', title: 'Spelling practice', due: at(2, 17), points: 10, done: false },
  { id: 't11', personId: 'mom', title: 'Sign the field trip form', due: at(0, 12), points: 5, done: false },
  { id: 't12', personId: 'mom', title: 'Grocery run', due: at(0, 14), points: 10, done: true, doneAt: at(0, 11) },
  { id: 't14', personId: 'dad', title: "Fix Leo's bike tire", due: at(0, 15), points: 10, done: false },
  { id: 't15', personId: 'dad', title: 'Pay soccer fees', due: at(-2, 17), points: 5, done: false },
  { id: 't16', personIds: ['maya', 'leo'], title: 'Fold the laundry together', start: at(-1, 0), due: at(1, 20), points: 10, done: false },
  // Repeating tasks with a cooldown: no due date, back 4 days after each time.
  { id: 't17', personIds: ['maya', 'leo'], title: 'Clean the basement', points: 1, cooldownDays: 4, needsApproval: true, done: false },
  { id: 't18', personId: 'maya', title: 'Clean your room', points: 1, cooldownDays: 4, needsApproval: true, done: true, doneAt: at(-1, 18) },
  // Ready again since 4 days ago and not done, so it shows as stale.
  { id: 't19', personId: 'leo', title: 'Vacuum the stairs', points: 5, cooldownDays: 3, done: true, doneAt: at(-7, 17) }
];
// Every task lists who it belongs to, as the Firebase source does.
tasks.forEach(t => {
  t.personIds = t.personIds || [t.personId];
  t.personId = t.personId || '';
  t.due = t.due || null;
  t.start = t.start || null;
  t.cooldownDays = t.cooldownDays || 0;
  t.needsApproval = !!t.needsApproval;
  t.pendingAt = t.pendingAt || null;
});

// Habit days for the past week, relative to today (0 = today, 1 = yesterday...).
const pastDays = offsets => Object.fromEntries(offsets.map(n => [dayKey(addDays(startOfDay(), -n)), true]));
const habits = [
  { id: 'h1', personId: 'maya', name: 'Read 20 minutes', order: 1, points: 1, bonus: 2, days: pastDays([1, 2, 3, 5, 6]) },
  { id: 'h2', personId: 'maya', name: 'Practice piano', order: 2, points: 2, perWeek: 5, bonus: 4, days: pastDays([1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) },
  { id: 'h3', personId: 'maya', name: 'Brush teeth at night', order: 3, days: pastDays([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) },
  { id: 'h4', personId: 'leo', name: 'Brush teeth', order: 1, days: pastDays([1, 2, 3, 4, 5, 6]) },
  { id: 'h5', personId: 'leo', name: 'Read with a grown-up', order: 2, days: pastDays([1, 2, 3, 4, 5, 6]) },
  { id: 'h6', personId: 'leo', name: 'Shoes by the door', order: 3, days: pastDays([1, 2, 3, 4, 5, 6]) },
  { id: 'h7', personId: 'mom', name: 'Walk 30 minutes', order: 1, perWeek: 4, days: pastDays([1, 3]) },
  { id: 'h9', personId: 'maya', name: 'Clean room', order: 4, points: 3, perWeek: 1, weekdays: ['fri', 'sat', 'sun'], needsApproval: true, days: {} },
  { id: 'h8', personId: 'dad', name: 'Morning stretch', order: 1, days: pastDays([1, 2, 3, 4]) }
];

const rewards = [
  { id: 'r1', title: 'Screen time', detail: 'Tablet, TV or games.', type: 'perUnit', cost: 1, unit: '15 minutes', unitMinutes: 15, active: true },
  { id: 'r7', title: 'Pokémon pack', detail: 'A parent sets the stars.', type: 'flexible', active: true },
  { id: 'r2', title: "Pick what's for dinner", detail: 'Any night this week.', cost: 75, active: true },
  { id: 'r3', title: 'Stay up 30 minutes late', detail: 'Friday or Saturday night.', cost: 100, active: true },
  { id: 'r4', title: 'Choose movie night', detail: 'You pick the movie and the snack.', cost: 120, active: true },
  { id: 'r5', title: '$5 allowance bonus', detail: 'Added to your next allowance.', cost: 150, active: true },
  { id: 'r6', title: 'Ice cream trip', detail: 'A weekend trip for the whole family.', cost: 200, active: true },
  { id: 'w1', title: 'Pancake breakfast', detail: 'You pick the toppings on Saturday.', cost: 30, weekly: true, active: true },
  { id: 'w2', title: 'Board game night', detail: 'You choose the game, everyone plays.', cost: 25, weekly: true, active: true },
  { id: 'w3', title: 'Build a blanket fort', detail: 'In the living room, up for one night.', cost: 35, weekly: true, active: true },
  { id: 'w4', title: 'Bake cookies with a parent', detail: 'You pick the kind.', cost: 40, weekly: true, active: true }
];

const claims = [
  { id: 'c1', personId: 'maya', rewardId: 'r1', title: 'Screen time', type: 'perUnit', quantity: 2, each: 1, unit: '15 minutes', unitMinutes: 15, cost: 2, status: 'pending', createdAt: at(0, 9) },
  { id: 'c3', personId: 'leo', rewardId: 'r7', title: 'Pokémon pack', type: 'flexible', quantity: 1, each: 0, cost: 0, status: 'pending', createdAt: at(0, 8) },
  { id: 'c2', personId: 'leo', rewardId: 'r2', title: "Pick what's for dinner", cost: 75, status: 'approved', createdAt: at(-1, 18) }
];

// Demo parent PIN is 1234 (salt "demo").
const digest = cleanDigest({
  title: 'Week of ' + at(0, 0).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
  updatedAt: at(0, 9),
  sections: [
    { heading: 'Heads up', items: [
      { when: fmtDay(2), text: 'No school: PA day' },
      { when: fmtDay(4) + ', 6:30pm', text: 'Belt testing at the dojang' }
    ] },
    { heading: 'Usual schedule', items: [
      { when: 'Mon & Thu, 5pm', text: 'Taekwondo' },
      { when: 'Wed, 4pm', text: 'Swim lesson' }
    ] },
    { heading: 'Action items', items: [
      { when: fmtDay(3), text: 'Field trip form due' },
      { when: '', text: 'Register for School Cash Online' }
    ] }
  ]
});

// Five weeks of point history so the weekly numbers have something to show.
const pointsLog = [];
people.forEach((p, n) => {
  for (let day = -34; day <= 0; day++) {
    const delta = 5 + ((day * 7 + n * 3) % 4 + 4) % 4 * 5;
    pointsLog.push({ personId: p.id, delta, reason: 'Sample task (on time)', at: at(day, 9) });
  }
  pointsLog.push({ personId: p.id, delta: -15, reason: 'Claimed: Pick dessert', at: at(-3, 18) });
});

const parentSettings = { pinHash: '', pinSalt: 'demo' };
export const DEMO_PIN = '1234';

tasks.forEach(t => { if (!('doneAt' in t)) t.doneAt = null; });

// A tiny in-memory store so check-offs work in demo mode.
const listeners = new Set();
const watch = fn => { listeners.add(fn); fn(); return () => listeners.delete(fn); };
const changed = () => listeners.forEach(fn => fn());
const copy = list => list.map(x => ({ ...x, days: x.days ? { ...x.days } : undefined }));

let user = null;
const authListeners = new Set();

export const source = {
  kind: 'demo',
  onAuth(cb) {
    authListeners.add(cb);
    cb(user);
    return () => authListeners.delete(cb);
  },
  async signIn(username) {
    user = { uid: 'demo', email: username || 'demo' };
    authListeners.forEach(cb => cb(user));
  },
  async signOut() {
    user = null;
    authListeners.forEach(cb => cb(user));
  },
  watchPeople(cb) { return watch(() => cb(copy(people))); },
  watchEvents(from, cb) { cb(events.filter(e => e.start >= from)); return () => {}; },
  watchTasks(dayStart, dayEnd, cb) { return watch(() => cb(copy(tasks))); },
  watchPersonTasks(personId, cb) { return watch(() => cb(copy(tasks.filter(t => t.personIds.includes(personId))))); },
  watchHabits(personId, cb) { return watch(() => cb(copy(habits.filter(h => h.personId === personId)))); },
  watchPendingTasks(cb) { return watch(() => cb(copy(tasks.filter(t => t.pendingAt)))); },
  watchAllHabits(cb) { return watch(() => cb(copy(habits))); },
  watchRewards(cb) { return watch(() => cb(rewards.map(r => ({ cost: 0, type: 'fixed', order: 999, ...r })))); },
  watchClaims(cb) { return watch(() => cb(claims.map(c => ({ type: 'fixed', quantity: 1, ...c })))); },
  watchParentSettings(cb) {
    hashPin(DEMO_PIN, parentSettings.pinSalt).then(pinHash => cb({ ...parentSettings, pinHash }));
    return () => {};
  },
  watchDigest(cb) { cb(digest); return () => {}; },
  watchPointsLog(from, cb) {
    return watch(() => cb({ first: pointsLog[0].at, entries: pointsLog.filter(e => e.at >= from).map(e => ({ ...e })) }));
  },
  async commit({ task, habit, person, people: changedPeople, logs, claimCreate, claimUpdate }) {
    if (claimCreate) claims.unshift({ id: 'c' + Date.now(), ...claimCreate, status: 'pending', createdAt: new Date() });
    if (claimUpdate) {
      const { id, ...fields } = claimUpdate;
      Object.assign(claims.find(c => c.id === id), fields);
    }
    if (task) {
      const t = tasks.find(x => x.id === task.id);
      if ('done' in task) Object.assign(t, { done: task.done, doneAt: task.done ? (task.doneAt || new Date()) : null });
      if (task.pending) t.pendingAt = new Date();
      else if (task.clearPending) t.pendingAt = null;
    }
    if (habit) {
      const h = habits.find(x => x.id === habit.id);
      if (habit.done) h.days[habit.day] = habit.value || true; else delete h.days[habit.day];
    }
    for (const p of [person, ...(changedPeople || [])].filter(Boolean)) {
      Object.assign(people.find(x => x.id === p.id), { points: p.points, streak: p.streak });
    }
    for (const log of logs || []) pointsLog.push({ ...log, at: new Date() });
    changed();
  }
};
