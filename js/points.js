// Point rules from the Rewards page: full points on time, no points late,
// each habit's own points per tick (2 if not set), plus the habit's own bonus
// (if any) the moment it meets its weekly goal (Monday to Sunday). The bonus is
// doubled when the habit is on a streak (it also met its goal the week before).
// Once a week, a person can spend points to save one missed day of one habit.
import { startOfDay, addDays, dayKey } from './dates.js';

export const HABIT_POINTS = 2;
export const SAVE_COST = 4;

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
// goal for display and locking, but only approved ticks earn points. A day
// saved with points ("saved") counts like an approved tick.
export function weekCount(habit, monday, { approvedOnly = false } = {}) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const v = habit.days[dayKey(d)];
    if ((approvedOnly ? v === true || v === 'saved' : v) && habitOnDay(habit, d)) n++;
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

function goalMet(habit, monday) {
  return weekCount(habit, monday, { approvedOnly: true }) >= habitGoal(habit);
}

// Whether any of a person's habits already used this week's save.
export function savedThisWeek(habits, monday) {
  return habits.some(h => [...Array(7)].some((_, i) => h.days[dayKey(addDays(monday, i))] === 'saved'));
}

// Whether `person` can spend SAVE_COST points to fill in the missed day d: an
// earlier day of this week that the habit is for, with the goal not yet met,
// and no save used on any habit this week.
export function canSave(habit, habits, person, d, today = new Date()) {
  const monday = weekStart(today);
  return startOfDay(d) < startOfDay(today) && startOfDay(d) >= monday
    && habitOnDay(habit, d) && !habit.days[dayKey(d)]
    && !goalMet(habit, monday) && !savedThisWeek(habits, monday)
    && person.points >= SAVE_COST;
}

// What a job is worth if finished at `at`.
export function taskValue(task, at = new Date()) {
  return isLate(task, at) ? 0 : task.points;
}

function isLate(task, at) {
  return !!task.due && at > task.due;
}

// Weeks in a row (ending this week, or last week if this week's goal isn't
// met yet) in which this habit met its weekly goal.
export function habitStreak(habit, today = new Date()) {
  let monday = weekStart(today);
  if (!goalMet(habit, monday)) monday = addDays(monday, -7);
  let n = 0;
  while (n < 520 && goalMet(habit, monday)) {
    n++;
    monday = addDays(monday, -7);
  }
  return n;
}

// A person's longest current habit streak (saved on the person as `streak`).
export function bestStreak(habits, today = new Date()) {
  return habits.reduce((n, h) => Math.max(n, habitStreak(h, today)), 0);
}

// The bonus for meeting the goal in the week starting `monday`: the habit's
// bonus, doubled if it also met its goal the week before (4, 8, 8, ...).
export function weekBonus(habit, monday) {
  const base = habitBonus(habit);
  return base && goalMet(habit, addDays(monday, -7)) ? base * 2 : base;
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
// A task with needsApproval, or one ticked after it was due, only goes to
// "pending" when ticked; points come when a grown-up approves it (see
// approveTaskChange). For a late task the grown-up decides the points.
export function taskChange(task, people, done, now = new Date()) {
  if (done && (task.needsApproval || isLate(task, now))) {
    return { task: { id: task.id, pending: true }, logs: [], delta: 0, pending: true };
  }
  if (task.pendingAt && !done) {
    return { task: { id: task.id, clearPending: true }, logs: [], delta: 0 };
  }
  return pointsForTask(task, people, done, done ? now : (task.doneAt || now), null);
}

// `doneAt` is the completion time to save (null means now, by the server).
// `award` is the points a grown-up chose for a late task (null: the rules).
function pointsForTask(task, people, done, at, doneAt, award = null) {
  // Unticking takes back what ticking gave, judged by when it was ticked.
  const late = isLate(task, at);
  const value = award ?? taskValue(task, at);
  const reason = `${task.title} (${done ? (late ? (value ? 'late, points given by a parent' : 'late') : 'on time') : 'unticked'})`;
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
// cooldown starts then). A late task pays `award` points each (0 if not
// given). Declining puts it back to open.
export function approveTaskChange(task, people, approve, now = new Date(), award = null) {
  if (!approve) return { task: { id: task.id, clearPending: true }, logs: [], delta: 0 };
  const at = task.pendingAt || now;
  const late = isLate(task, at);
  return pointsForTask(task, people, true, at, at, late ? Math.max(0, award || 0) : null);
}

// Whether a pending task was ticked after it was due.
export function tickedLate(task) {
  return !!task.pendingAt && isLate(task, task.pendingAt);
}

// The points (and bonus, if this tick meets the weekly goal) for setting or
// clearing an approved tick on `day`. A save (`saved`) costs SAVE_COST instead
// of paying the tick's points.
function habitPointsChange(habit, habits, person, done, day, today, saved = false) {
  const monday = weekStart(day);
  const key = dayKey(day);
  const mark = saved ? 'saved' : done || undefined;
  const next = habits.map(h => h.id === habit.id
    ? { ...h, days: { ...h.days, [key]: mark } }
    : h);
  const self = next.find(h => h.id === habit.id) || { ...habit, days: { ...habit.days, [key]: mark } };
  const before = goalMet(habit, monday);
  const after = goalMet(self, monday);
  const logs = [];
  const value = habitPoints(habit);
  let delta = saved ? -SAVE_COST : done ? value : -value;
  logs.push({ personId: person.id, delta, reason: saved ? `Streak save: ${habit.name} (${key})` : `${habit.name} (${done ? 'done' : 'unticked'})` });
  // A habit's bonus is earned by the tick that meets its weekly goal, and
  // taken back if that tick is undone. On a streak it's doubled.
  const streakBonus = weekBonus(habit, monday);
  const onStreak = streakBonus > habitBonus(habit);
  let bonus = 0;
  if (done && !before && after) bonus = streakBonus;
  if (!done && before && !after) bonus = -streakBonus;
  if (bonus) {
    logs.push({ personId: person.id, delta: bonus, reason: `${habit.name} weekly goal${onStreak ? ' (streak x2)' : ''}${bonus < 0 ? ' (unticked)' : ''}` });
    delta += bonus;
  }
  // Points never go below zero.
  if (person.points + delta < 0) {
    const shortBy = person.points + delta;
    delta -= shortBy;
    logs[logs.length - 1].delta -= shortBy;
  }
  return {
    person: { id: person.id, points: person.points + delta, streak: bestStreak(next, today) },
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

// Spending SAVE_COST points to fill in a missed day (a YYYY-MM-DD key) of this
// week. It counts toward the goal, streak and bonus, but pays no tick points.
export function saveDayChange(habit, habits, person, day, today = new Date()) {
  const [y, m, d] = day.split('-').map(Number);
  return { habit: { id: habit.id, day, done: true, value: 'saved' }, ...habitPointsChange(habit, habits, person, true, new Date(y, m - 1, d, 12), today, true) };
}

// A grown-up's answer to a pending tick on `day` (a YYYY-MM-DD key):
// approving pays the points (and bonus), declining clears the tick.
export function approveHabitChange(habit, person, day, approve, today = new Date()) {
  if (!approve) return { habit: { id: habit.id, day, done: false }, logs: [], delta: 0 };
  const [y, m, d] = day.split('-').map(Number);
  const change = habitPointsChange(habit, [habit], person, true, new Date(y, m - 1, d, 12), today);
  // The saved streak needs all of a person's habits, which aren't loaded here.
  change.person.streak = person.streak;
  return { habit: { id: habit.id, day, done: true }, ...change };
}

// Reward types: "fixed" costs `cost` points; "flexible" has its points set by a
// parent when approving (`cost` is only the starting suggestion); "perUnit"
// costs `cost` points per unit (for example 1 point per 15 minutes) and can be
// claimed several units at a time.
export function rewardType(reward) {
  return reward.type === 'flexible' || reward.type === 'perUnit' ? reward.type : 'fixed';
}

// "45 minutes", "1 hour 30 minutes", or "3 × 15 minutes".
export function unitAmount(quantity, unit, unitMinutes) {
  if (unitMinutes > 0) {
    const total = quantity * unitMinutes;
    const h = Math.floor(total / 60);
    const m = total % 60;
    const parts = [];
    if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
    if (m || !h) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
    return parts.join(' ');
  }
  return `${quantity} × ${unit || 'unit'}`;
}

// What a claim is for, such as "Screen time, 45 minutes".
export function claimLabel(claim) {
  return claim.type === 'perUnit'
    ? `${claim.title}, ${unitAmount(claim.quantity, claim.unit, claim.unitMinutes)}`
    : claim.title;
}

// The most units someone can claim at once with their points.
export function maxUnits(reward, person) {
  const each = Math.max(1, reward.cost);
  const cap = reward.maxQty > 0 ? reward.maxQty : 20;
  return Math.max(0, Math.min(cap, Math.floor(person.points / each)));
}

// Claiming spends the points now (nothing yet for a flexible reward, whose
// points a parent sets when approving); a parent approves or declines later.
export function claimChange(reward, person, quantity = 1) {
  const type = rewardType(reward);
  const claim = { personId: person.id, rewardId: reward.id, title: reward.title };
  let cost = reward.cost;
  if (type === 'flexible') {
    cost = 0;
    Object.assign(claim, { type, quantity: 1, each: Math.max(0, reward.cost) });
  } else if (type === 'perUnit') {
    cost = quantity * reward.cost;
    Object.assign(claim, { type, quantity, each: reward.cost, unit: reward.unit, unitMinutes: reward.unitMinutes });
  }
  claim.cost = cost;
  return {
    claimCreate: claim,
    person: { id: person.id, points: person.points - cost, streak: person.streak },
    logs: cost ? [{ personId: person.id, delta: -cost, reason: `Claimed: ${claimLabel(claim)}` }] : []
  };
}

// Declining gives back whatever was spent; approving a fixed reward changes nothing else.
export function decideChange(claim, person, status) {
  const change = { claimUpdate: { id: claim.id, status }, logs: [] };
  if (status === 'denied' && person && claim.cost) {
    change.person = { id: person.id, points: person.points + claim.cost, streak: person.streak };
    change.logs.push({ personId: person.id, delta: claim.cost, reason: `Returned: ${claimLabel(claim)}` });
  }
  return change;
}

// Approving a flexible or per-unit claim with the amount the parent settled on:
// the difference from what was already spent is taken or given back.
export function approveClaimChange(claim, person, quantity, each) {
  const total = quantity * each;
  const final = { ...claim, quantity, each, cost: total };
  const change = { claimUpdate: { id: claim.id, status: 'approved', cost: total, quantity, each }, logs: [], delta: total - claim.cost };
  if (change.delta && person) {
    change.person = { id: person.id, points: person.points - change.delta, streak: person.streak };
    change.logs.push({
      personId: person.id,
      delta: -change.delta,
      reason: change.delta > 0 ? `Reward: ${claimLabel(final)}` : `Returned (changed by a parent): ${claimLabel(final)}`
    });
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

// Point changes from claiming or giving back rewards, and streak saves, are
// spending, not earning.
const SPENDING = /^(Claimed|Returned|Reward|Streak save)\b/;

// Points earned this week (Monday to Sunday) and the average per week over the
// previous `weeks` full weeks, from one person's pointsLog entries. Ticks,
// unticks, bonuses and parent adjustments count; rewards don't. Weeks before
// the hub's first log entry (`since`) are left out of the average; with no
// full week yet, the average is null.
export function weeklyPoints(logs, today, since, weeks = 4) {
  const monday = weekStart(today);
  const first = since ? weekStart(since) : monday;
  const totals = [...Array(weeks + 1)].fill(0);
  for (const log of logs) {
    if (!log.at || SPENDING.test(log.reason || '')) continue;
    const i = Math.round((monday - weekStart(log.at)) / (7 * 24 * 60 * 60 * 1000));
    if (i >= 0 && i <= weeks) totals[i] += log.delta;
  }
  const counted = totals.slice(1).filter((_, i) => addDays(monday, -7 * (i + 1)) >= first);
  return {
    thisWeek: totals[0],
    average: counted.length ? Math.round(counted.reduce((a, b) => a + b, 0) / counted.length) : null
  };
}
