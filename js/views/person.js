import { esc, avatar, icons } from '../ui.js';
import { fmt, addDays, dayKey, daysBetween, inWindow } from '../dates.js';
import { taskValue, taskView, habitStreak, habitPoints, habitGoal, habitBonus, habitDays, habitOnDay, canTick, weekCount } from '../points.js';

const MAX_COMING_UP = 10;
const check = size => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const hourglass = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/></svg>';
const clock = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

function dueLabel(task, dayStart, dayEnd) {
  if (task.pending) return "Waiting for a grown-up's OK";
  // A task with no due date: a repeating one rests after it's done.
  if (!task.due) {
    if (task.againAt) return `Done · back ${fmt.weekday(task.againAt)} ${fmt.time(task.againAt)}`;
    return task.done ? 'Done' : 'Any time';
  }
  // A task with a window, e.g. "Fri to Sun, by 8:00 PM".
  if (task.start && daysBetween(task.start, task.due) > 0 && task.due >= dayStart) {
    return `${fmt.weekday(task.start)} to ${fmt.weekday(task.due)}, by ${fmt.time(task.due)}`;
  }
  if (task.due >= dayStart && task.due < dayEnd) return `Today, ${fmt.time(task.due)}`;
  if (task.due < dayStart) return `Was due ${fmt.weekday(task.due)}, ${fmt.shortDate(task.due)}`;
  if (daysBetween(dayStart, task.due) === 1) return `Tomorrow, ${fmt.time(task.due)}`;
  return `${fmt.weekday(task.due)}, ${fmt.shortDate(task.due)}`;
}

// Late: overdue from an earlier day (still open, or finished today).
// Today: due today, a task whose window covers today, or an any-time task
// that can be done now. Coming up: due later and not done yet. Resting: a
// repeating task in its cooldown. Expects tasks from taskView.
export function sortTasks(tasks, dayStart, dayEnd) {
  const sections = { late: [], today: [], later: [], resting: [] };
  for (const t of tasks) {
    if (!t.due) {
      if (t.againAt && !(t.doneAt && t.doneAt >= dayStart)) sections.resting.push(t);
      else sections.today.push(t);
      continue;
    }
    if (inWindow(t, dayStart, dayEnd)) {
      sections.today.push(t);
    } else if (t.due >= dayEnd) {
      if (!t.done) sections.later.push(t);
    } else if (t.due >= dayStart) {
      sections.today.push(t);
    } else if (!t.done || (t.doneAt && t.doneAt >= dayStart)) {
      sections.late.push(t);
    }
  }
  // Dated tasks by due time, then any-time ones; resting ones by when they're back.
  const order = t => (t.due ? t.due.getTime() : t.againAt ? t.againAt.getTime() : Infinity);
  Object.values(sections).forEach(list => list.sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title)));
  sections.later = sections.later.slice(0, MAX_COMING_UP);
  return sections;
}

// Names the other people on a shared task, e.g. "With Wesley".
function withLabel(t, p, people) {
  const others = t.personIds.filter(id => id !== p.id)
    .map(id => (people.find(x => x.id === id) || {}).name).filter(Boolean);
  return others.length ? ` · With ${others.join(' and ')}` : '';
}

function taskRow(t, p, people, now, dayStart, dayEnd) {
  const value = t.done ? taskValue(t, t.doneAt || now) : taskValue(t, t.pendingAt || now);
  const late = !t.done && !t.pending && t.due && t.due < now;
  const style = t.done ? `background:${p.color};border-color:${p.color};color:#FFFFFF`
    : t.pending ? `border-style:dashed;border-color:${p.color};color:${p.color}` : `color:${p.color}`;
  const label = t.pending ? `Cancel, waiting for OK: ${t.title}` : `${t.done ? 'Mark not done' : 'Mark done'}: ${t.title}`;
  return `
    <div class="task ${t.done ? 'done' : ''} ${t.pending ? 'pending' : ''}">
      <button type="button" class="check" data-action="toggle-task" data-id="${esc(t.id)}"
        aria-label="${esc(label)}" style="${style}">
        ${t.done ? check(26) : t.pending ? hourglass : ''}
      </button>
      <div class="task-body">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-due ${late ? 'late' : ''}">${clock}${esc(dueLabel(t, dayStart, dayEnd) + withLabel(t, p, people))}</div>
      </div>
      <div class="pts" style="${t.done ? '' : `background:${p.soft};color:${p.color}`}">+${value}</div>
    </div>`;
}

function habitGrid(habits, p, today) {
  if (!habits.length) return '<div class="empty">No habits yet.</div>';
  // Monday to Sunday of this week.
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const week = [...Array(7)].map((_, i) => addDays(monday, i));
  const todayKey = dayKey(today);
  const head = week.map(d => {
    const isToday = dayKey(d) === todayKey;
    return `<div class="wd ${isToday ? 'today' : ''}">${fmt.weekday(d).charAt(0)}</div>`;
  }).join('');
  const rows = habits.map(h => {
    const goal = habitGoal(h);
    const count = weekCount(h, monday);
    const approved = weekCount(h, monday, { approvedOnly: true });
    const cells = week.map(d => {
      const key = dayKey(d);
      const done = h.days[key] === true;
      const pending = h.days[key] === 'pending';
      // Days this habit isn't for are left blank.
      if (!habitOnDay(h, d)) return '<div class="cell off" aria-hidden="true"></div>';
      if (key === todayKey && !canTick(h, d)) {
        return '<div class="cell off" aria-hidden="true" title="Weekly goal already met"></div>';
      }
      if (key === todayKey && pending) {
        return `<button type="button" class="cell today pending" data-action="toggle-habit" data-id="${esc(h.id)}"
          aria-label="${esc(h.name)} today: waiting for a grown-up's OK" style="border-color:${p.color};color:${p.color}">${hourglass}</button>`;
      }
      if (pending) return `<div class="cell pending" style="border-color:${p.color};color:${p.color}" title="Waiting for OK">${hourglass}</div>`;
      if (key === todayKey) {
        return `<button type="button" class="cell today" data-action="toggle-habit" data-id="${esc(h.id)}"
          aria-label="${esc(h.name)} today: ${done ? 'done' : 'not done yet'}"
          style="${done ? `background:${p.color};border-color:${p.color};color:#FFFFFF` : `border-color:${p.color}`}">${done ? check(20) : ''}</button>`;
      }
      const future = d > today;
      // Once the weekly goal is reached, the rest of the week is closed.
      if (future && count >= goal) return '<div class="cell off" aria-hidden="true"></div>';
      const style = done ? `background:${p.color};color:#FFFFFF` : '';
      return `<div class="cell ${future ? 'future' : done ? '' : 'missed'}" style="${style}" aria-hidden="true">${done ? check(20) : ''}</div>`;
    }).join('');
    const bonus = habitBonus(h);
    const allowed = habitDays(h);
    const onDays = allowed.length < 7 ? week.filter(d => allowed.includes(d.getDay())).map(d => fmt.weekday(d)).join(', ') : '';
    // A habit due every allowed day (and with no bonus) names its days, or
    // says "Daily"; others show progress toward the weekly goal.
    const goalText = goal === allowed.length && !bonus
      ? (onDays || 'Daily')
      : `${Math.min(count, goal)} of ${goal}${approved >= goal ? ' ✓' : ''}`;
    const label = (onDays ? `on ${onDays}, ` : goal === 7 ? 'every day, ' : '')
      + (goal < allowed.length ? `${goal} times a week, ` : '')
      + `${count} done this week, ${habitPoints(h)} points` + (bonus ? `, ${bonus} point bonus for the week` : '');
    return `<div class="habit-name">${esc(h.name)}
      <span class="habit-meta ${approved >= goal ? 'met' : ''}" title="${esc(label)}">${goalText} · +${habitPoints(h)}${bonus ? ` · bonus ${bonus}` : ''}${count > approved ? ' · waiting for OK' : h.needsApproval ? ' · needs OK' : ''}</span></div>${cells}`;
  }).join('');
  return `<div class="habit-grid"><div></div>${head}${rows}</div>`;
}

export function renderPerson({ person: p, people = [], tasks, habits, loading, now, today, dayStart, dayEnd }) {
  if (!p) {
    return `<div class="card"><h2>Not found</h2><p class="note">That person isn't in the hub. <a href="#/home">Go home</a>.</p></div>`;
  }
  const sections = sortTasks(tasks.map(t => taskView(t, now)), dayStart, dayEnd);
  const due = [...sections.late, ...sections.today];
  const done = due.filter(t => t.done).length;
  const doneText = !due.length ? 'Nothing due today.'
    : done === due.length ? 'Everything for today is done. Great job!'
    : `${done} of ${due.length} tasks done today`;
  const streak = habitStreak(habits, today);
  const groups = [
    { label: 'Late', note: 'No points now, but still worth doing', cls: 'late', list: sections.late },
    { label: 'Today', note: '', cls: '', list: sections.today },
    { label: 'Coming up', note: '', cls: '', list: sections.later },
    { label: 'Done for now', note: 'Back after a rest', cls: '', list: sections.resting }
  ].filter(g => g.list.length);

  return `
    <header class="person-head" style="background:${p.soft}">
      ${avatar(p, 72)}
      <div style="flex:1;min-width:0">
        <h1>${esc(p.name)}'s tasks</h1>
        <div class="person-sub">${loading.tasks ? '' : doneText}</div>
      </div>
      <div class="stats">
        <div class="stat"><small>${icons.star}POINTS</small><b>${p.points}</b></div>
        <div class="stat"><small>${icons.flame}STREAK</small><b>${streak} ${streak === 1 ? 'week' : 'weeks'}</b></div>
      </div>
    </header>
    <div class="person-grid">
      <section class="card stack" aria-labelledby="jobs-h">
        <h2 id="jobs-h">Tasks</h2>
        ${loading.tasks ? '<div class="empty">Loading…</div>'
          : !groups.length ? '<div class="empty">No tasks right now.</div>'
          : groups.map(g => `
            <div class="task-group">
              <div class="group-head"><span class="group-label ${g.cls}">${g.label}</span>${g.note ? `<span class="note">${g.note}</span>` : ''}</div>
              ${g.list.map(t => taskRow(t, p, people, now, dayStart, dayEnd)).join('')}
            </div>`).join('')}
      </section>
      <section class="card stack" aria-labelledby="habits-h">
        <div>
          <h2 id="habits-h">Habits this week</h2>
          <p class="note" style="margin-top:4px">Tap today's square when you've done it.</p>
        </div>
        ${loading.habits ? '<div class="empty">Loading…</div>' : habitGrid(habits, p, today)}
        ${habits.some(h => habitBonus(h)) ? '<div class="empty" style="color:var(--ink-2)">Meet a habit\'s weekly goal to earn its bonus.</div>' : ''}
      </section>
    </div>`;
}
