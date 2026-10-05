import { esc, avatar, icons } from '../ui.js';
import { fmt, greeting, daysBetween, addDays, inWindow } from '../dates.js';
import { taskView } from '../points.js';
import { describe, outfit } from '../weather.js';

const MAX_LATER = 5;

function rangeLabel(a, b) {
  const sameMonth = a.getMonth() === b.getMonth();
  return `${fmt.shortDate(a)} to ${sameMonth ? b.getDate() : fmt.shortDate(b)}`;
}

function groupEvents(events, today) {
  const groups = [
    { key: 'today', day: 'Today', date: fmt.dayDate(today), items: [] },
    { key: 'tomorrow', day: 'Tomorrow', date: fmt.dayDate(addDays(today, 1)), items: [] },
    { key: 'week', day: 'This week', date: rangeLabel(addDays(today, 2), addDays(today, 6)), items: [] },
    { key: 'later', day: 'Later', date: '', items: [] }
  ];
  for (const e of events) {
    if (!e.start) continue;
    const diff = daysBetween(today, e.start);
    if (diff < 0) continue;
    let g, time;
    if (diff === 0 || diff === 1) {
      g = groups[diff];
      time = e.allDay ? 'All day' : fmt.time(e.start);
    } else if (diff < 7) {
      g = groups[2];
      time = e.allDay ? fmt.weekday(e.start) : `${fmt.weekday(e.start)} ${fmt.time(e.start)}`;
    } else {
      g = groups[3];
      time = fmt.shortDate(e.start);
    }
    g.items.push({ ...e, time });
  }
  groups[3].items = groups[3].items.slice(0, MAX_LATER);
  return groups.filter(g => g.items.length);
}

function chipsFor(event, peopleById) {
  const ids = event.who.filter(id => id !== 'all' && peopleById.has(id));
  if (!ids.length) return [{ name: 'Everyone', color: 'var(--ink)' }];
  return ids.map(id => peopleById.get(id));
}

// Tasks that count toward today's progress: anything due by tonight that is
// still open, plus anything due today or finished today, plus tasks whose
// start-to-due window covers today, plus any-time tasks that can be done now
// or were done today. Expects tasks from taskView.
export function todaysTasks(tasks, dayStart, dayEnd) {
  return tasks.filter(t => {
    if (!t.due) return !t.done || (t.doneAt && t.doneAt >= dayStart);
    return inWindow(t, dayStart, dayEnd) || (t.due < dayEnd &&
      (!t.done || t.due >= dayStart || (t.doneAt && t.doneAt >= dayStart)));
  });
}

const noteIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>';

// An event with notes is a button that opens them in place.
function eventRow(e, peopleById, openEvent) {
  const open = e.notes && openEvent === e.id;
  const body = `
    <div class="event-time">${esc(e.time)}</div>
    <div class="event-body">
      <div class="event-title">${esc(e.title)}</div>
      ${e.place ? `<div class="event-place">${esc(e.place)}</div>` : ''}
      <div class="chips">
        ${chipsFor(e, peopleById).map(p => `<span class="chip"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`).join('')}
        ${e.notes && !open ? `<span class="chip note-hint">${noteIcon}Notes</span>` : ''}
      </div>
      ${open ? `<div class="event-notes">${esc(e.notes)}</div>` : ''}
    </div>`;
  if (!e.notes) return `<div class="event">${body}</div>`;
  return `<button type="button" class="event has-notes ${open ? 'open' : ''}" data-action="toggle-event" data-id="${esc(e.id)}"
    aria-expanded="${open ? 'true' : 'false'}">${body}</button>`;
}

function renderEvents(groups, peopleById, openEvent) {
  if (!groups.length) return '<div class="empty">Nothing on the calendar yet.</div>';
  return groups.map(g => `
    <div class="day">
      <div class="day-head"><b>${esc(g.day)}</b>${g.date ? `<span>${esc(g.date)}</span>` : ''}</div>
      ${g.items.map(e => eventRow(e, peopleById, openEvent)).join('')}
    </div>`).join('');
}

const MAX_JOBS = 4;

// Today's tasks for one person: late and stale ones first, then other open
// ones, then done ones, with shared tasks naming the other people on them.
function jobList(mine, p, peopleById, dayStart) {
  if (!mine.length) return '';
  const rank = t => (t.overdue || t.stale ? 0 : t.done ? 2 : 1);
  const sorted = [...mine].sort((a, b) => (rank(a) - rank(b)) || ((a.due || Infinity) - (b.due || Infinity)));
  const shown = sorted.slice(0, MAX_JOBS);
  const more = sorted.length - shown.length;
  return `
    <ul class="member-jobs">
      ${shown.map(t => {
        const others = t.personIds.filter(id => id !== p.id).map(id => peopleById.get(id)?.name).filter(Boolean);
        const red = t.overdue || t.stale;
        return `<li class="${t.done ? 'done' : ''} ${red ? 'overdue' : ''}">
          <span class="job-dot" style="${t.done ? `background:${p.color};border-color:${p.color}` : `border-color:${p.color}`}"></span>
          <span class="job-title">${esc(t.title)}${others.length ? ` <span class="job-with">with ${esc(others.join(' and '))}</span>` : ''}</span>
          <span class="job-time ${red ? 'late' : ''}">${t.done ? 'Done' : t.pending ? 'Waiting for OK' : t.stale ? 'Overdue' : !t.due ? 'Any time' : t.overdue ? 'Late' : daysBetween(dayStart, t.due) > 0 ? `By ${esc(fmt.weekday(t.due))}` : esc(fmt.time(t.due))}</span>
        </li>`;
      }).join('')}
      ${more > 0 ? `<li class="job-more">+${more} more</li>` : ''}
    </ul>`;
}

function renderJobs(people, tasks, peopleById, dayStart) {
  if (!people.length) {
    return '<div class="empty">No one is set up yet. Family members appear here once the hub has its data.</div>';
  }
  return people.map(p => {
    const mine = tasks.filter(t => t.personIds.includes(p.id));
    const done = mine.filter(t => t.done).length;
    const left = mine.length - done;
    const pct = mine.length ? Math.round(done * 100 / mine.length) : 0;
    const leftText = !mine.length ? 'Nothing today' : left === 0 ? 'All done!' : `${left} to go`;
    return `
      <a class="member" href="#/person/${encodeURIComponent(p.id)}">
        ${avatar(p, 48)}
        <div class="member-body">
          <div class="member-top"><b>${esc(p.name)}</b><span>${leftText}</span></div>
          <div class="bar"><div style="width:${pct}%;background:${p.color}"></div></div>
          ${jobList(mine, p, peopleById, dayStart)}
          <div class="member-foot"><span>${done} of ${mine.length} done</span><b>${p.points} pts</b></div>
        </div>
      </a>`;
  }).join('');
}

const MAX_SPELLS = 3;

function hourLabel(d) {
  if (d.getHours() === 0 && d.getMinutes() === 0) return 'midnight';
  return d.toLocaleTimeString('en-US', { hour: 'numeric' });
}

function dayWord(d, today) {
  const diff = daysBetween(today, d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// "Today 2 PM to 6 PM", "Now to 4 PM" or "Tue 10 PM to Wed 3 AM".
function spellWhen(s, now, today) {
  // An end at midnight belongs to the day before it.
  const endDay = new Date(s.end.getTime() - 1);
  const sameDay = daysBetween(s.start, endDay) === 0;
  const from = s.start <= now ? 'Now' : `${dayWord(s.start, today)} ${hourLabel(s.start)}`;
  const to = sameDay || s.start <= now && daysBetween(today, endDay) === 0
    ? hourLabel(s.end)
    : `${dayWord(endDay, today)} ${hourLabel(s.end)}`;
  return `${from} to ${to}`;
}

const kindIcon = kind => (kind === 'Snow' ? '🌨️' : kind === 'Storms' ? '⛈️' : kind === 'Rain and snow' ? '🌨️' : '🌧️');

// Current weather, the rain and snow coming in the next few days, and a week strip.
function renderWeather(weather, now, today) {
  if (!weather) return '';
  const cur = describe(weather.now.code);
  const todayFc = weather.days.find(d => daysBetween(today, d.date) === 0);
  const spells = weather.spells.slice(0, MAX_SPELLS);
  const week = weather.days.filter(d => daysBetween(today, d.date) >= 0);
  return `
    <section class="card weather" aria-labelledby="weather-head">
      <div class="weather-now">
        <span class="weather-icon" aria-hidden="true">${cur.icon}</span>
        <div>
          <h2 id="weather-head" class="weather-temp">${weather.now.temp}°</h2>
          <div class="weather-text">${esc(cur.text)}${cur.text ? ' in ' : ''}${esc(weather.place)}</div>
          <div class="note">${todayFc ? `High ${todayFc.high}° · Low ${todayFc.low}° · ` : ''}Feels like ${weather.now.feels}°</div>
        </div>
      </div>
      <div class="weather-wet">
        ${spells.length ? spells.map(s => `
          <div class="wet-row">
            <span class="wet-icon" aria-hidden="true">${kindIcon(s.kind)}</span>
            <div><b>${esc(s.kind)}</b> <span class="wet-chance">${s.chance}%</span><div class="wet-when">${esc(spellWhen(s, now, today))}</div></div>
          </div>`).join('')
        : '<div class="wet-row dry"><span class="wet-icon" aria-hidden="true">🌂</span><div>No rain or snow in the next 3 days</div></div>'}
      </div>
      <div class="weather-week">
        ${week.map(d => {
          const c = describe(d.code);
          const wet = d.kind && d.chance >= 30;
          return `<div class="wday ${wet ? 'wet' : ''}" title="${esc(c.text)}">
            <b>${daysBetween(today, d.date) === 0 ? 'Today' : esc(fmt.weekday(d.date))}</b>
            <span class="wday-icon" aria-label="${esc(c.text)}">${c.icon}</span>
            <span class="wday-temp">${d.high}° <span>${d.low}°</span></span>
            <span class="wday-wet">${wet ? `${esc(d.kind === 'Snow' ? 'Snow' : d.kind === 'Rain and snow' ? 'Mix' : d.kind === 'Storms' ? 'Storms' : 'Rain')} ${d.chance}%` : '&nbsp;'}</span>
          </div>`;
        }).join('')}
      </div>
      ${renderOutfit(outfit(weather, now))}
    </section>`;
}

function renderOutfit(o) {
  if (!o) return '';
  const range = o.low === o.high ? `${o.low}°` : `${o.low}° to ${o.high}°`;
  const extra = o.snow && o.rain ? ', rain and snow' : o.snow ? ', snow' : o.rain ? ', rain' : '';
  return `
    <div class="outfit">
      <div class="outfit-head"><b>What to wear ${esc(o.when.toLowerCase())}</b><span>${esc(o.summary)}, feels like ${esc(range)}${esc(extra)}</span></div>
      <ul class="outfit-items">
        ${o.items.map(i => `<li><span aria-hidden="true">${i.icon}</span>${esc(i.text)}</li>`).join('')}
      </ul>
    </div>`;
}

// The weekly digest from the Claude routine, full width under the two cards.
function renderDigest(digest) {
  if (!digest || !digest.sections.length) return '';
  const updated = digest.updatedAt ? `Updated ${fmt.weekday(digest.updatedAt)} ${fmt.shortDate(digest.updatedAt)}` : '';
  return `
    <section class="card digest" aria-labelledby="digest-head">
      <div class="digest-head">
        <h2 id="digest-head">${esc(digest.title || 'This week')}</h2>
        ${updated ? `<span class="note">${esc(updated)}</span>` : ''}
      </div>
      <div class="digest-grid">
        ${digest.sections.map(s => `
          <div class="digest-section">
            ${s.heading ? `<h3>${esc(s.heading)}</h3>` : ''}
            <ul>
              ${s.items.map(i => `<li>${i.when ? `<b>${esc(i.when)}</b>` : ''}<span>${esc(i.text)}</span></li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>
    </section>`;
}

// "7:58" and "AM" for the home page clock, which shows on iPad-sized screens only.
function clockParts(d) {
  const [time, ampm] = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).split(/\s/);
  return { time, ampm };
}

function renderClock(d) {
  const { time, ampm } = clockParts(d);
  return `<div class="clock" aria-hidden="true"><span class="clock-time">${esc(time)}</span><span class="clock-ampm">${esc(ampm || '')}</span></div>`;
}

// Keeps the clock on the minute between full re-renders.
export function tickClock(d = new Date()) {
  const el = document.querySelector('.clock');
  if (!el) return;
  const { time, ampm } = clockParts(d);
  const t = el.querySelector('.clock-time');
  if (t.textContent !== time) t.textContent = time;
  el.querySelector('.clock-ampm').textContent = ampm || '';
}

export function renderHome({ now, today, dayStart, dayEnd, people, events, tasks, loading, digest, openEvent, weather }) {
  const peopleById = new Map(people.map(p => [p.id, p]));
  const todays = todaysTasks(tasks.map(t => taskView(t, now)), dayStart, dayEnd);
  return `
    <header class="page-head home-head">
      <div>
        <div class="eyebrow">${esc(fmt.longDate(today))}</div>
        <h1>${greeting(now)}, family</h1>
      </div>
      ${renderClock(new Date())}
    </header>
    ${renderWeather(weather, now, today)}
    <div class="home-grid">
      <section class="card events" aria-labelledby="coming-up">
        <h2 id="coming-up">${icons.calendar}Coming up</h2>
        ${loading.events ? '<div class="empty">Loading…</div>' : renderEvents(groupEvents(events, today), peopleById, openEvent)}
      </section>
      <section class="card jobs" aria-labelledby="todays-jobs">
        <h2 id="todays-jobs">Today's tasks</h2>
        ${loading.people || loading.tasks ? '<div class="empty">Loading…</div>' : renderJobs(people, todays, peopleById, dayStart)}
        ${people.length ? '<p class="note">Tap a name to see their list.</p>' : ''}
      </section>
    </div>
    ${renderDigest(digest)}`;
}
