import { esc, avatar, icons } from '../ui.js';

const STATUS = {
  pending: ['Waiting for a parent', '#8A4B00'],
  approved: ['Approved', '#0F766E'],
  denied: ['Not this time, points returned', 'var(--muted)']
};

export function renderRewards({ people, rewards, claims, claimer, loading }) {
  const byId = new Map(people.map(p => [p.id, p]));
  const who = byId.get(claimer) || people[0];
  const list = rewards.filter(r => r.active).sort((a, b) => a.cost - b.cost || a.title.localeCompare(b.title));
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

  const cards = !list.length
    ? '<div class="empty" style="grid-column:1/-1">No rewards yet.</div>'
    : list.map(r => {
      const ok = who && who.points >= r.cost;
      const label = !who ? 'Pick someone' : ok ? `Claim for ${esc(who.name)}` : `Need ${r.cost - who.points} more`;
      return `
        <div class="reward">
          <div class="reward-cost">${icons.star}${r.cost} points</div>
          <div class="reward-title">${esc(r.title)}</div>
          <div class="reward-detail">${esc(r.detail)}</div>
          <button type="button" class="reward-btn" data-action="claim" data-id="${esc(r.id)}" ${ok ? '' : 'disabled'}
            style="${ok ? `background:${who.color};color:#FFFFFF` : ''}">${label}</button>
        </div>`;
    }).join('');

  const recentHtml = !recent.length ? '<p class="note">No claims yet.</p>' : recent.map(c => {
    const p = byId.get(c.personId) || { name: '?', color: 'var(--muted)' };
    const [label, color] = STATUS[c.status] || STATUS.pending;
    return `
      <div class="claim">
        ${avatar(p, 36)}
        <div class="claim-body"><b>${esc(c.title)}</b><span style="color:${color}">${esc(p.name)}, ${label}</span></div>
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
          <div class="kv"><span>Task done late</span><b>Half points</b></div>
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
