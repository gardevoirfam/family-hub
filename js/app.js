import { esc, avatar, colorsFor, icons } from './ui.js';
import { startOfDay, addDays, dayKey } from './dates.js';
import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { renderPerson } from './views/person.js';
import { renderRewards } from './views/rewards.js';
import { renderParents, claimDraft } from './views/parents.js';
import { taskChange, habitChange, claimChange, decideChange, approveClaimChange, maxUnits, rewardType, claimLabel, adjustChange, approveHabitChange, approveTaskChange, taskState, canTick, weekStart } from './points.js';
import { hashPin } from './pin.js';

const root = document.getElementById('app');
const demo = new URLSearchParams(location.search).has('demo');

const state = {
  user: undefined,
  people: [],
  events: [],
  tasks: [],
  rewards: [],
  claims: [],
  approvalHabits: [],
  pendingTasks: [],
  parentPin: { pinHash: '', pinSalt: '' },
  digest: null,
  openEvent: null,
  claimer: null,
  // How many units of a per-unit reward (such as screen time) are picked, by reward id.
  claimQty: {},
  // The Parents dialog. Unlocking lasts until it is closed.
  parents: { open: false, unlocked: false, pin: '', pinError: false, log: [], edits: {} },
  loading: { people: true, events: true, tasks: true, rewards: true },
  error: '',
  day: dayKey(),
  login: { error: '', busy: false, username: '' },
  // The person page's own data, loaded while that page is open.
  focus: { id: null, tasks: [], habits: [], log: null, loading: { tasks: true, habits: true } },
  toast: ''
};

let source;
let unsubs = [];
let focusUnsubs = [];
let toastTimer = null;
let shell = null;

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'person' && parts[1]) return { name: 'person', id: parts[1] };
  if (parts[0] === 'rewards') return { name: 'rewards' };
  return { name: 'home' };
}

function dayBounds() {
  const dayStart = startOfDay();
  return { today: dayStart, dayStart, dayEnd: addDays(dayStart, 1) };
}

function onDataError(err) {
  console.error(err);
  state.error = err && err.code === 'permission-denied'
    ? "This login isn't allowed to read the hub's data yet. A grown-up needs to publish the database rules."
    : "Couldn't load the hub's data. It will retry on its own.";
  render();
}

function stopListeners() {
  unsubs.forEach(u => u());
  unsubs = [];
}

// keepData shows what's already on screen while fresh data loads, so a
// refresh doesn't flash "Loading…".
function startListeners({ keepData = false } = {}) {
  stopListeners();
  if (!keepData) state.loading = { people: true, events: true, tasks: true, rewards: true };
  state.error = '';
  const { dayStart, dayEnd } = dayBounds();
  state.day = dayKey(dayStart);
  unsubs.push(source.watchPeople(list => {
    state.people = list
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((p, i) => ({ ...p, ...colorsFor(p, i) }));
    state.loading.people = false;
    render();
  }, onDataError));
  unsubs.push(source.watchEvents(dayStart, list => {
    state.events = list;
    state.loading.events = false;
    render();
  }, onDataError));
  unsubs.push(source.watchTasks(dayStart, dayEnd, list => {
    state.tasks = list;
    state.loading.tasks = false;
    render();
  }, onDataError));
  unsubs.push(source.watchRewards(list => {
    state.rewards = list;
    state.loading.rewards = false;
    render();
  }, onDataError));
  unsubs.push(source.watchPendingTasks(list => {
    state.pendingTasks = list;
    render();
  }, onDataError));
  unsubs.push(source.watchApprovalHabits(list => {
    state.approvalHabits = list;
    render();
  }, onDataError));
  unsubs.push(source.watchClaims(list => {
    state.claims = list;
    render();
  }, onDataError));
  unsubs.push(source.watchDigest(digest => {
    state.digest = digest;
    render();
  }, onDataError));
  unsubs.push(source.watchParentSettings(settings => {
    state.parentPin = settings;
    render();
  }, onDataError));
}

function stopFocus() {
  focusUnsubs.forEach(u => u());
  focusUnsubs = [];
  state.focus = { id: null, tasks: [], habits: [], log: null, loading: { tasks: true, habits: true } };
}

// Keeps the person page's listeners in step with the route.
function syncFocus(route, { refresh = false } = {}) {
  const id = route.name === 'person' ? route.id : null;
  if (id === state.focus.id && !refresh) return;
  if (id && id === state.focus.id) {
    // Same person: resubscribe for fresh data but keep what's on screen.
    focusUnsubs.forEach(u => u());
    focusUnsubs = [];
  } else {
    stopFocus();
  }
  if (!id) return;
  state.focus.id = id;
  focusUnsubs.push(source.watchPersonTasks(id, list => {
    if (state.focus.id !== id) return;
    state.focus.tasks = list;
    state.focus.loading.tasks = false;
    render();
  }, onDataError));
  focusUnsubs.push(source.watchHabits(id, list => {
    if (state.focus.id !== id) return;
    state.focus.habits = list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    state.focus.loading.habits = false;
    render();
  }, onDataError));
  // This week and the four full weeks before it, for the weekly points.
  focusUnsubs.push(source.watchPointsLog(addDays(weekStart(new Date()), -28), ({ first, entries }) => {
    if (state.focus.id !== id) return;
    state.focus.log = { first, entries: entries.filter(e => e.personId === id) };
    render();
  }, onDataError));
}

function showToast(text) {
  state.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = ''; render(); }, 2600);
}

async function save(change, okToast) {
  try {
    await source.commit(change);
    if (okToast) showToast(okToast);
    refreshData();
  } catch (err) {
    console.error(err);
    showToast("That didn't save. Try again.");
    render();
  }
}

function closeParents() {
  state.parents = { open: false, unlocked: false, pin: '', pinError: false, log: [], edits: {} };
  render();
}

async function pressPinKey(key) {
  const p = state.parents;
  if (key === 'Clear') p.pin = '';
  else if (key === 'Delete') p.pin = p.pin.slice(0, -1);
  else if (p.pin.length < 4) p.pin += key;
  p.pinError = false;
  render();
  if (p.pin.length === 4) {
    const entered = p.pin;
    const hash = await hashPin(entered, state.parentPin.pinSalt);
    if (state.parents.pin !== entered) return;
    if (hash === state.parentPin.pinHash) state.parents = { ...state.parents, unlocked: true, pin: '' };
    else state.parents = { ...state.parents, pin: '', pinError: true };
    render();
  }
}

async function handleAction(el) {
  const { action, id } = el.dataset;
  const personById = pid => state.people.find(p => p.id === pid);

  if (action === 'sign-out') {
    if (confirm('Sign out of Family Hub? A grown-up will need the password to sign back in.')) await source.signOut();
    return;
  }
  if (action === 'open-parents') {
    state.parents = { open: true, unlocked: false, pin: '', pinError: false, log: [], edits: {} };
    render();
    return;
  }
  if (action === 'close-parents') return closeParents();
  if (action === 'toggle-event') {
    state.openEvent = state.openEvent === id ? null : id;
    render();
    return;
  }
  if (action === 'pin-key') return pressPinKey(id);
  if (action === 'pick-claimer') {
    state.claimer = id;
    render();
    return;
  }
  if (action === 'claim-qty') {
    const reward = state.rewards.find(r => r.id === id);
    const person = personById(state.claimer) || state.people[0];
    if (!reward || !person) return;
    const n = (state.claimQty[id] || 1) + Number(el.dataset.delta);
    state.claimQty[id] = Math.max(1, Math.min(n, maxUnits(reward, person)));
    render();
    return;
  }
  if (action === 'claim') {
    const reward = state.rewards.find(r => r.id === id);
    const person = personById(state.claimer) || state.people[0];
    if (!reward || !person) return;
    const type = rewardType(reward);
    if (type === 'flexible') {
      if (person.points <= 0) return;
      return save(claimChange(reward, person), 'Claimed! A parent will set the points.');
    }
    if (type === 'perUnit') {
      const max = maxUnits(reward, person);
      if (max < 1) return;
      const qty = Math.min(Math.max(1, state.claimQty[id] || 1), max);
      state.claimQty[id] = 1;
      return save(claimChange(reward, person, qty), 'Claimed! A parent will OK it soon.');
    }
    if (person.points < reward.cost) return;
    return save(claimChange(reward, person), 'Claimed! A parent will OK it soon.');
  }
  if (action === 'claim-edit' && state.parents.unlocked) {
    const claim = state.claims.find(c => c.id === id);
    if (!claim || claim.status !== 'pending') return;
    const draft = { ...claimDraft(claim, state.parents.edits) };
    const field = el.dataset.field === 'quantity' ? 'quantity' : 'each';
    draft[field] = Math.max(field === 'quantity' ? 1 : 0, draft[field] + Number(el.dataset.delta));
    state.parents.edits = { ...state.parents.edits, [id]: draft };
    render();
    return;
  }
  if (action === 'approve-claim' && state.parents.unlocked) {
    const claim = state.claims.find(c => c.id === id);
    if (!claim || claim.status !== 'pending') return;
    const person = personById(claim.personId);
    const { quantity, each } = claimDraft(claim, state.parents.edits);
    const change = approveClaimChange(claim, person, quantity, each);
    if (person && person.points - change.delta < 0) return;
    const total = quantity * each;
    const settled = { ...claim, quantity, each, cost: total };
    state.parents.log = [`${person ? person.name : 'Someone'}: ${claimLabel(settled)} approved, ${total} ${total === 1 ? 'point' : 'points'}`, ...state.parents.log].slice(0, 4);
    return save(change);
  }
  if (action === 'adjust' && state.parents.unlocked) {
    const person = personById(id);
    if (!person) return;
    const change = adjustChange(person, Number(el.dataset.delta));
    if (!change.delta) return;
    const sign = change.delta > 0 ? '+' : '−';
    state.parents.log = [`${person.name}: ${sign}${Math.abs(change.delta)} points (now ${change.person.points})`, ...state.parents.log].slice(0, 4);
    return save(change);
  }
  if (action === 'decide-task' && state.parents.unlocked) {
    const task = state.pendingTasks.find(t => t.id === id);
    if (!task || !task.pendingAt) return;
    const people = task.personIds.map(personById).filter(Boolean);
    if (!people.length) return;
    const approve = el.dataset.status === 'approved';
    const change = approveTaskChange(task, people, approve);
    const names = people.map(p => p.name).join(' and ');
    state.parents.log = [`${names}: ${task.title} ${approve ? `approved, +${change.delta} ${change.delta === 1 ? 'point' : 'points'}${people.length > 1 ? ' each' : ''}` : 'not approved'}`, ...state.parents.log].slice(0, 4);
    return save(change);
  }
  if (action === 'decide-habit' && state.parents.unlocked) {
    const habit = state.approvalHabits.find(h => h.id === id);
    const day = el.dataset.day;
    const person = habit && personById(habit.personId);
    if (!habit || !person || habit.days[day] !== 'pending') return;
    const approve = el.dataset.status === 'approved';
    const change = approveHabitChange(habit, person, day, approve);
    state.parents.log = [`${person.name}: ${habit.name} ${approve ? `approved, +${change.delta} points` : 'not approved'}`, ...state.parents.log].slice(0, 4);
    return save(change);
  }
  if (action === 'decide' && state.parents.unlocked) {
    const claim = state.claims.find(c => c.id === id);
    if (!claim || claim.status !== 'pending') return;
    const status = el.dataset.status;
    const person = personById(claim.personId);
    const who = person ? person.name : 'Someone';
    state.parents.log = [`${who}: ${claimLabel(claim)} ${status === 'approved' ? 'approved' : claim.cost ? `declined, ${claim.cost} points returned` : 'declined'}`, ...state.parents.log].slice(0, 4);
    return save(decideChange(claim, person, status));
  }

  const person = personById(state.focus.id);
  if (!person) return;
  if (action === 'toggle-task') {
    const task = state.focus.tasks.find(t => t.id === id);
    if (!task) return;
    // A shared task pays everyone on it.
    const people = task.personIds.map(personById).filter(Boolean);
    if (!people.length) people.push(person);
    // Ticking an open task does it; ticking a done or waiting one undoes that.
    const change = taskChange(task, people, taskState(task) === 'open');
    const names = people.map(p => p.name).join(' and ');
    if (change.pending) showToast(`${task.title}: waiting for a grown-up to OK it`);
    else if (change.delta > 0) showToast(`Nice work, ${names}! +${change.delta} ${change.delta === 1 ? 'point' : 'points'}${people.length > 1 ? ' each' : ''}`);
    return save(change);
  }
  if (action === 'toggle-habit') {
    const habit = state.focus.habits.find(h => h.id === id);
    if (!habit || !canTick(habit, new Date())) return;
    const done = !habit.days[dayKey()];
    const change = habitChange(habit, state.focus.habits, person, done);
    if (change.pending) showToast(`${habit.name}: waiting for a grown-up to OK it`);
    else if (change.bonus) showToast(`${habit.name} goal met this week! +${change.delta} points`);
    else if (done) showToast(`${habit.name} done! +${change.delta} points`);
    return save(change);
  }
}

// Re-reads everything from the server. Listeners already stream changes; this
// is a belt-and-braces refresh on tab switches, after taps and on wake-up.
function refreshData() {
  if (!state.user) return;
  startListeners({ keepData: true });
  syncFocus(parseRoute(), { refresh: true });
}

function navHtml(route) {
  const personBtns = state.people.map(p => {
    const active = route.name === 'person' && route.id === p.id;
    const style = active ? `background:${p.soft};color:${p.color}` : '';
    return `<a class="nav-btn" href="#/person/${encodeURIComponent(p.id)}" style="${style}" ${active ? 'aria-current="page"' : ''}>${avatar(p, 42)}${esc(p.name)}</a>`;
  }).join('');
  const link = (name, href, icon, label) =>
    `<a class="nav-btn ${route.name === name ? 'active' : ''}" href="${href}" ${route.name === name ? 'aria-current="page"' : ''}>${icon}${label}</a>`;
  return `
    <div class="logo dark">FH</div>
    ${link('home', '#/home', icons.home, 'Home')}
    ${personBtns}
    ${link('rewards', '#/rewards', icons.gift, 'Rewards')}
    <div class="nav-spacer"></div>
    <button type="button" class="nav-btn small" data-action="open-parents">${icons.lock}Parents</button>
    <button type="button" class="nav-btn small" data-action="sign-out">${icons.signOut}Sign out</button>`;
}

function mainHtml(route) {
  const now = new Date();
  const banner = state.error ? `<div class="empty form-error" role="alert" style="margin-bottom:20px">${esc(state.error)}</div>` : '';
  if (route.name === 'person') {
    if (state.loading.people) return banner + '<div class="empty">Loading…</div>';
    return banner + renderPerson({
      now, ...dayBounds(),
      person: state.people.find(p => p.id === route.id),
      people: state.people,
      tasks: state.focus.tasks, habits: state.focus.habits, log: state.focus.log, loading: state.focus.loading
    });
  }
  if (route.name === 'rewards') {
    return banner + renderRewards({
      people: state.people, rewards: state.rewards, claims: state.claims,
      claimer: state.claimer, claimQty: state.claimQty, loading: state.loading
    });
  }
  return banner + renderHome({ now, ...dayBounds(), ...state });
}

function ensureShell() {
  if (shell) return shell;
  root.innerHTML = `
    <div class="shell">
      <nav class="nav" aria-label="Main"></nav>
      <main class="main" id="main"></main>
    </div>
    <div class="offline" role="status" hidden>Offline. Showing saved info.</div>
    <div class="toast" role="status" hidden></div>
    <div class="overlay"></div>`;
  shell = {
    nav: root.querySelector('.nav'),
    main: root.querySelector('.main'),
    offline: root.querySelector('.offline'),
    toast: root.querySelector('.toast'),
    overlay: root.querySelector('.overlay')
  };
  return shell;
}

function render() {
  if (state.user === undefined) return;
  if (!state.user) {
    shell = null;
    renderLogin(root, { ...state.login, onSubmit: handleSignIn });
    return;
  }
  const s = ensureShell();
  const route = parseRoute();
  syncFocus(route);
  s.nav.innerHTML = navHtml(route);
  s.main.innerHTML = mainHtml(route);
  s.offline.hidden = navigator.onLine;
  s.toast.hidden = !state.toast;
  s.toast.textContent = state.toast;
  s.overlay.innerHTML = state.parents.open
    ? renderParents({ ...state.parents, people: state.people, claims: state.claims, approvalHabits: state.approvalHabits, pendingTasks: state.pendingTasks, hasPin: !!state.parentPin.pinHash })
    : '';
}

async function handleSignIn(username, password) {
  if (!username || !password) {
    state.login = { busy: false, username, error: 'Enter the username and password.' };
    render();
    return;
  }
  state.login = { busy: true, username, error: '' };
  render();
  try {
    await source.signIn(username, password);
    state.login = { busy: false, username: '', error: '' };
  } catch (err) {
    state.login = { busy: false, username, error: err.message };
    render();
  }
}

async function boot() {
  try {
    ({ source } = demo ? await import('./source-demo.js') : await import('./source-firebase.js'));
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="boot"><div class="card" style="max-width:480px"><h2>Can't start Family Hub</h2><p class="note" style="margin-top:10px">Check the internet connection, then reload the page.</p></div></div>`;
    return;
  }
  source.onAuth(user => {
    const wasSignedIn = !!state.user;
    state.user = user;
    if (user && !wasSignedIn) startListeners();
    if (!user) {
      stopListeners();
      stopFocus();
      state.parents = { open: false, unlocked: false, pin: '', pinError: false, log: [], edits: {} };
      state.people = []; state.events = []; state.tasks = [];
    }
    render();
  });
  if (demo && !state.user) await source.signIn('demo');
}

// One click handler for every [data-action] button in the signed-in app.
root.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (btn && shell) handleAction(btn);
});

window.addEventListener('hashchange', () => {
  state.toast = '';
  refreshData();
  render();
  if (shell) shell.main.scrollTop = 0;
});
window.addEventListener('online', render);
window.addEventListener('offline', render);

// The iPad stays open for days: refresh the greeting and roll "today" over at midnight.
// Coming back to the app (screen on, or switching back from another app)
// reloads the page, which picks up new versions of the app and fresh data.
// A short glance away only refreshes the data. While the hub sits open, it
// also reloads every hour once nobody has touched it for a couple of minutes.
// Reloads only happen while signed in and online, so they never leave a blank page.
const RELOAD_AFTER_HIDDEN = 60 * 1000;
const RELOAD_EVERY = 60 * 60 * 1000;
const IDLE_BEFORE_RELOAD = 2 * 60 * 1000;
const loadedAt = Date.now();
let lastTouch = Date.now();
let hiddenAt = null;

['pointerdown', 'keydown', 'scroll'].forEach(type =>
  window.addEventListener(type, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));

function canReload() {
  return state.user && navigator.onLine && !demo && !state.parents.open;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    // Screen off locks the parent controls again.
    if (state.parents.open) closeParents();
    return;
  }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = null;
  if (away > RELOAD_AFTER_HIDDEN && canReload()) location.reload();
  else refreshData();
});

setInterval(() => {
  if (!state.user) return;
  if (Date.now() - loadedAt > RELOAD_EVERY && Date.now() - lastTouch > IDLE_BEFORE_RELOAD && canReload()) {
    location.reload();
    return;
  }
  if (dayKey() !== state.day) {
    startListeners();
    stopFocus();
  }
  render();
}, 60 * 1000);

boot();
