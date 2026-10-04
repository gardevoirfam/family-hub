import { esc, avatar, icons } from '../ui.js';
import { rewardType, unitAmount, claimLabel, maxUnits } from '../points.js';

function claimStatus(c) {
  const pts = n => `${n} ${n === 1 ? 'point' : 'points'}`;
  if (c.status === 'approved') return [c.type === 'fixed' ? 'Approved' : `Approved, ${pts(c.cost)}`, '#0F766E'];
  if (c.status === 'denied') return [c.cost ? 'Not this time, points returned' : 'Not this time', 'var(--muted)'];
  return [c.type === 'flexible' ? 'Waiting for a parent to set the points' : 'Waiting for a parent', '#8A4B00'];
}

function card(r, who, qty) {
  const type = rewardType(r);
  const btn = (ok, label) => `
    <button type="button" class="reward-btn" data-action="claim" data-id="${esc(r.id)}" ${ok ? '' : 'disabled'}
      style="${ok ? `background:${who.color};color:#FFFFFF` : ''}">${label}</button>`;
  let cost, extra = '', button;
  if (type === 'flexible') {
    cost = 'A parent sets the points';
    const ok = who && who.points > 0;
    button = btn(ok, !who ? 'Pick someone' : ok ? `Claim for ${esc(who.name)}` : 'Need some points first');
  } else if (type === 'perUnit') {
    const each = Math.max(1, r.cost);
    cost = `${each} ${each === 1 ? 'point' : 'points'} = ${esc(r.unitMinutes ? unitAmount(1, r.unit, r.unitMinutes) : r.unit || 'one')}`;
    const max = who ? maxUnits(r, who) : 0;
    const n = Math.min(Math.max(1, qty || 1), Math.max(1, max));
    if (max > 0) {
      extra = `
        <div class="qty" role="group" aria-label="How much">
          <button type="button" class="step" data-action="claim-qty" data-id="${esc(r.id)}" data-delta="-1" ${n <= 1 ? 'disabled' : ''} aria-label="Less">−</button>
          <b>${esc(unitAmount(n, r.unit, r.unitMinutes))}</b>
          <button type="button" class="step" data-action="claim-qty" data-id="${esc(r.id)}" data-delta="1" ${n >= max ? 'disabled' : ''} aria-label="More">+</button>
        </div>`;
    }
    const total = n * each;
    button = btn(max > 0, !who ? 'Pick someone' : max > 0 ? `Claim for ${esc(who.name)} (${total} ${total === 1 ? 'point' : 'points'})` : `Need ${each - who.points} more`);
  } else {
    cost = `${r.cost} points`;
    const ok = who && who.points >= r.cost;
    button = btn(ok, !who ? 'Pick someone' : ok ? `Claim for ${esc(who.name)}` : `Need ${r.cost - who.points} more`);
  }
  return `
    <div class="reward${r.weekly ? ' weekly' : ''}">
      <div class="reward-cost">${icons.star}${cost}</div>
      <div class="reward-title">${esc(r.title)}</div>
      <div class="reward-detail">${esc(r.detail)}</div>
      ${extra}
      ${button}
    </div>`;
}

export function renderRewards({ people, rewards, claims, claimer, claimQty = {}, loading }) {
  const byId = new Map(people.map(p => [p.id, p]));
  const who = byId.get(claimer) || people[0];
  const sorted = rewards.filter(r => r.active).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.cost - b.cost || a.title.localeCompare(b.title));
  const recent = claims.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  const pickers = people.map(p => {
    const on = who && p.id === who.id;
    return `
      <button type="button" class="picker" data-action="pick-claimer" data-id="${esc(p.id)}" aria-pressed="${on}"
        style="${on ? `background:${p.soft};border-color:${p.color}` : ''}">
        ${avatar(p, 40)}
        <span class="picker-text"><b>${esc(p.name)}</b><span>${p.points} points</span></span>
      </button>`;
  }).join('');

  const weekly = sorted.filter(r => r.weekly);
  const always = sorted.filter(r => !r.weekly);
  const cardsOf = list => list.map(r => card(r, who, claimQty[r.id])).join('');
  const heading = (text, note) => `<h2 class="reward-group">${text}${note ? `<span>${note}</span>` : ''}</h2>`;
  const cards = !sorted.length
    ? '<div class="empty" style="grid-column:1/-1">No rewards yet.</div>'
    : (weekly.length
      ? heading("This week's rewards", 'New ones every Monday') + cardsOf(weekly) + (always.length ? heading('Every week') + cardsOf(always) : '')
      : cardsOf(always));

  const recentHtml = !recent.length ? '<p class="note">No claims yet.</p>' : recent.map(c => {
    const p = byId.get(c.personId) || { name: '?', color: 'var(--muted)' };
    const [label, color] = claimStatus(c);
    return `
      <div class="claim">
        ${avatar(p, 36)}
        <div class="claim-body"><b>${esc(claimLabel(c))}</b><span style="color:${color}">${esc(p.name)}, ${label}</span></div>
      </div>`;
  }).join('');

  return `
    <header class="page-head" style="margin-bottom:22px">
      <h1>Rewards</h1>
      <p class="lede" style="margin:6px 0 0;font-size:17px;color:var(--muted)">Finish tasks on time and keep your habits going to earn points.</p>
    </header>
    ${people.length ? `<div class="pickers" role="group" aria-label="Who is claiming">${pickers}</div>` : ''}
    <div class="rewards-grid">
      <section class="reward-list" aria-label="Rewards to claim">
        ${loading.rewards ? '<div class="empty" style="grid-column:1/-1">Loading…</div>' : cards}
      </section>
      <div class="stack" style="gap:16px">
        <section class="card side">
          <h2>How points work</h2>
          <div class="kv"><span>Task done on time</span><b>Full points</b></div>
          <div class="kv"><span>Task done late</span><b>A parent decides</b></div>
          <div class="kv"><span>Habit ticked</span><b>Its points</b></div>
          <div class="kv"><span>Habit's weekly goal met</span><b>Its bonus</b></div>
        </section>
        <section class="card side">
          <h2>Recent claims</h2>
          ${recentHtml}
        </section>
      </div>
    </div>`;
}
