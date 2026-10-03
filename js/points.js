// Point rules from the Rewards page: full points on time, half points late,
// each habit's own points per tick (2 if not set), plus the habit's own bonus
// (if any) the moment it meets its weekly goal (Monday to Sunday).
import { startOfDay, addDays, dayKey } from './dates.js';

export const HABIT_POINTS = 2;

// Extra points when a habit meets its weekly goal (0 if not set).
export function habitBonus(habit) {
  return Number.isInteger(habit.bonus) && habit.bonus > 0 ? habit.bonus : 0;
}

// Points for one tick of a habit.
export function habitPoints(habit) {
  return Number.isInteger(habit.points) && habit.points >= 0 ? habit.points : HABIT_POINTS;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// The days of the week (0 = Sunday) a habit can be ticked on. A habit with
// `weekdays` (e.g. ["sat"]) only counts on those days; otherwise every day.
export function habitDays(habit) {
  const list = Array.isArray(habit.weekdays)
    ? habit.weekdays.map(d => WEEKDAYS.indexOf(String(d).toLowerCase().slice(0, 3))).filter(n => n >= 0)
    : [];
  return list.length ? [...new Set(list)] : [0, 1, 2, 3, 4, 5, 6];
}

export function habitOnDay(habit, d) {
  return habitDays(habit).includes(new Date(d).getDay());
}

// Ticks needed per week: perWeek if set, else one per allowed day.
export function habitGoal(habit) {
  const max = habitDays(habit).length;
  return Number.isInteger(habit.perWeek) ? Math.min(max, Math.max(1, habit.perWeek)) : max;
}

// Monday of the week containing d.
export function weekStart(d = new Date()) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

// Ticks in the Monday-to-Sunday week starting `monday`. A tick on a habit
// that needs a grown-up's OK is "pending" until approved; it counts toward the
// goal for display and locking, but only approved ticks earn points.
export function weekCount(habit, monday, { approvedOnly = false } = {}) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const v = habit.days[dayKey(d)];
    if ((approvedOnly ? v === true : v) && habitOnDay(habit, d)) n++;
  }
  return n;
}

// Whether a habit can be ticked on day d: it must be one of its days, and once
// the weekly goal is met the rest of the week is closed (so "once between Friday
// and Sunday" can't be ticked again on Saturday). A ticked day can always be
// unticked.
export function canTick(habit, d) {
  if (habit.days[dayKey(d)]) return true;
  return habitOnDay(habit, d) && weekCount(habit, weekStart(d)) < habitGoal(habit);
}

function allGoalsMet(habits, monday) {
  return habits.length > 0 && habits.every(h => weekCount(h, monday, { approvedOnly: true }) >= habitGoal(h));
}

// What a job is worth if finished at `at`.
export function taskValue(task, at = new Date()) {
  const late = task.due && at > task.due;
  return late ? Math.floor(task.points / 2) : task.points;
}

// Weeks in a row (ending this week, or last week if this week's goals aren't
// met yet) in which every habit met its weekly goal.
export function habitStreak(habits, today = new Date()) {
  if (!habits.length) return 0;
  let monday = weekStart(today);
  if (!allGoalsMet(habits, monday)) monday = addDays(monday, -7);
  let n = 0;
  while (n < 520 && allGoalsMet(habits, monday)) {
    n++;
    monday = addDays(monday, -7);
  }
  return n;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A repeating task (one with cooldownDays) can be done again once its cooldown
// has passed since it was last done.
export function isRepeating(task) {
  return task.cooldownDays > 0;
}

export function availableAgainAt(task) {
  return isRepeating(task) && task.done && task.doneAt
    ? new Date(task.doneAt.getTime() + task.cooldownDays * DAY_MS)
    : null;
}

// How a task stands right now: "pending" (ticked, waiting for a grown-up's
// OK), "done" (done, or resting in its cooldown) or "open" (can be ticked).
export function taskState(task, now = new Date()) {
  if (task.pendingAt) return 'pending';
  if (!task.done) return 'open';
  const again = availableAgainAt(task);
  return again && now >= again ? 'open' : 'done';
}

// A task as the pages show it right now: a repeating task whose cooldown has
// passed reads as not done, and `pending` / `againAt` are filled in.
export function taskView(task, now = new Date()) {
  const state = taskState(task, now);
  return { ...task, done: state === 'done', pending: state === 'pending', againAt: state === 'done' ? availableAgainAt(task) : null };
}

// Builds the change for ticking or unticking a task. A shared task pays every
// person on it the full value, so `people` is everyone the task belongs to.
// A task with needsApproval only goes to "pending" when ticked; points come
// when a grown-up approves it (see approveTaskChange).
export function taskChange(task, people, done, now = new Date()) {
  if (task.needsApproval && done) {
    return { task: { id: task.id, pending: true }, logs: [], delta: 0, pending: true };
  }
  if (task.pendingAt && !done) {
    return { task: { id: task.id, clearPending: true }, logs: [], delta: 0 };
  }
  return pointsForTask(task, people, done, done ? now : (task.doneAt || now), null);
}

// `doneAt` is the completion time to save (null means now, by the server).
function pointsForTask(task, people, done, at, doneAt) {
  // Unticking takes back what ticking gave, judged by when it was ticked.
  const value = taskValue(task, at);
  const reason = `${task.title} (${done ? (value === task.points ? 'on time' : 'late') : 'unticked'})`;
  const changes = people.map(person => {
    const delta = done ? value : -Math.min(value, person.points);
    return { person, delta };
  });
  return {
    task: { id: task.id, done, doneAt: done ? doneAt : null, clearPending: !!task.pendingAt },
    people: changes.map(({ person, delta }) => ({ id: person.id, points: person.points + delta, streak: person.streak })),
    logs: changes.filter(c => c.delta).map(({ person, delta }) => ({ personId: person.id, delta, reason })),
    delta: done ? value : -value
  };
}

// A grown-up's answer to a pending task. Approving pays everyone on it, as if
// it was done when it was ticked (so it isn't late if ticked on time, and its
// cooldown starts then). Declining puts it back to open.
export function approveTaskChange(task, people, approve, now = new Date()) {
  if (!approve) return { task: { id: task.id, clearPending: true }, logs: [], delta: 0 };
  const at = task.pendingAt || now;
  return pointsForTask(task, people, true, at, at);
}

// The points (and bonus, if this tick meets the weekly goal) for setting or
// clearing an approved tick on `day`.
function habitPointsChange(habit, habits, person, done, day, today) {
  const monday = weekStart(day);
  const key = dayKey(day);
  const next = habits.map(h => h.id === habit.id
    ? { ...h, days: { ...h.days, [key]: done || undefined } }
    : h);
  const self = next.find(h => h.id === habit.id) || { ...habit, days: { ...habit.days, [key]: done || undefined } };
  const goal = habitGoal(habit);
  const before = weekCount(habit, monday, { approvedOnly: true }) >= goal;
  const after = weekCount(self, monday, { approvedOnly: true }) >= goal;
  const logs = [];
  const value = habitPoints(habit);
  let delta = done ? value : -value;
  logs.push({ personId: person.id, delta, reason: `${habit.name} (${done ? 'done' : 'unticked'})` });
  // A habit's bonus is earned by the tick that meets its weekly goal, and
  // taken back if that tick is undone.
  let bonus = 0;
  if (done && !before && after) bonus = habitBonus(habit);
  if (!done && before && !after) bonus = -habitBonus(habit);
  if (bonus) {
    logs.push({ personId: person.id, delta: bonus, reason: `${habit.name} weekly goal${bonus < 0 ? ' (unticked)' : ''}` });
    delta += bonus;
  }
  // Points never go below zero.
  if (person.points + delta < 0) {
    const shortBy = person.points + delta;
    delta -= shortBy;
    logs[logs.length - 1].delta -= shortBy;
  }
  return {
    person: { id: person.id, points: person.points + delta, streak: habitStreak(next, today) },
    logs: logs.filter(l => l.delta),
    delta,
    bonus: bonus > 0
  };
}

// Builds the change for ticking or unticking today's square of a habit. A
// habit with needsApproval only marks the day "pending"; points come when a
// grown-up approves it (see approveHabitChange).
export function habitChange(habit, habits, person, done, today = new Date()) {
  const day = dayKey(today);
  const current = habit.days[day];
  if (habit.needsApproval && (done || current === 'pending')) {
    return { habit: { id: habit.id, day, done, value: 'pending' }, logs: [], delta: 0, pending: done };
  }
  return { habit: { id: habit.id, day, done }, ...habitPointsChange(habit, habits, person, done, today, today) };
}

// A grown-up's answer to a pending tick on `day` (a YYYY-MM-DD key):
// approving pays the points (and bonus), declining clears the tick.
export function approveHabitChange(habit, person, day, approve, today = new Date()) {
  if (!approve) return { habit: { id: habit.id, day, done: false }, logs: [], delta: 0 };
  const [y, m, d] = day.split('-').map(Number);
  const change = habitPointsChange(habit, [habit], person, true, new Date(y, m - 1, d, 12), today);
  // The streak needs all of a person's habits, which aren't loaded here.
  change.person.streak = person.streak;
  return { habit: { id: habit.id, day, done: true }, ...change };
}

// Claiming a reward spends its points now; a parent approves or declines later.
export function claimChange(reward, person) {
  return {
    claimCreate: { personId: person.id, rewardId: reward.id, title: reward.title, cost: reward.cost },
    person: { id: person.id, points: person.points - reward.cost, streak: person.streak },
    logs: [{ personId: person.id, delta: -reward.cost, reason: `Claimed: ${reward.title}` }]
  };
}

// Declining gives the points back; approving changes nothing else.
export function decideChange(claim, person, status) {
  const change = { claimUpdate: { id: claim.id, status }, logs: [] };
  if (status === 'denied' && person) {
    change.person = { id: person.id, points: person.points + claim.cost, streak: person.streak };
    change.logs.push({ personId: person.id, delta: claim.cost, reason: `Returned: ${claim.title}` });
  }
  return change;
}

// A parent's manual adjustment. Points never go below zero.
export function adjustChange(person, delta) {
  const applied = Math.max(delta, -person.points);
  return {
    person: { id: person.id, points: person.points + applied, streak: person.streak },
    logs: applied ? [{ personId: person.id, delta: applied, reason: 'Parent adjustment' }] : [],
    delta: applied
  };
}
