import { esc, avatar, icons } from '../ui.js';
import { unitAmount, claimLabel, tickedLate } from '../points.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Delete'];

function pinPad({ pin, pinError, hasPin }) {
  if (!hasPin) {
    return `
      <div class="pin">
        <div class="pin-icon">${icons.lock}</div>
        <h2>Parents only</h2>
        <p class="note" style="max-width:400px;font-size:16px">No parent PIN has been set yet. Ask Claude to set one.</p>
        <button type="button" class="btn-outline" data-action="close-parents">Close</button>
      </div>`;
  }
  return `
    <div class="pin">
      <div class="pin-icon">${icons.lock}</div>
      <h2>Parents only</h2>
      <p class="note" style="max-width:380px;font-size:16px">Enter the PIN to change points or approve rewards.</p>
      <div class="pin-dots" aria-label="${pin.length} of 4 digits entered">
        ${[0, 1, 2, 3].map(i => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}
      </div>
      ${pinError ? `<div class="form-error" role="alert">That PIN didn't match. Try again.</div>` : ''}
      <div class="keys">
        ${KEYS.map(k => `<button type="button" class="key ${k.length > 1 ? 'word' : ''}" data-action="pin-key" data-id="${k}">${k}</button>`).join('')}
      </div>
      <button type="button" class="btn-outline" data-action="close-parents">Cancel</button>
    </div>`;
}

// Pending ticks on habits that need a grown-up's OK, oldest first.
function pendingHabitTicks(habits) {
  const list = [];
  for (const h of habits) {
    for (const [day, v] of Object.entries(h.days)) if (v === 'pending') list.push({ habit: h, day });
  }
  return list.sort((a, b) => a.day.localeCompare(b.day));
}

function dayName(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// What a parent will settle a flexible or per-unit claim at: their edits so far,
// or what the claim asked for.
export function claimDraft(claim, edits = {}) {
  return edits[claim.id] || { quantity: claim.quantity || 1, each: claim.each || 0 };
}

function stepBtn(claim, field, delta, label, disabled) {
  return `<button type="button" class="step" data-action="claim-edit" data-id="${esc(claim.id)}" data-field="${field}" data-delta="${delta}" ${disabled ? 'disabled' : ''} aria-label="${label}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</button>`;
}

function claimRow(c, p, edits) {
  const decline = `<button type="button" class="btn-outline small" data-action="decide" data-id="${esc(c.id)}" data-status="denied">Not now</button>`;
  if (c.type !== 'flexible' && c.type !== 'perUnit') {
    return `
      <div class="adjust">
        ${avatar(p, 40)}
        <div class="claim-body" style="flex:1"><b>${esc(c.title)}</b><span>${esc(p.name)} spent ${c.cost} points</span></div>
        ${decline}
        <button type="button" class="btn-approve" data-action="decide" data-id="${esc(c.id)}" data-status="approved">Approve</button>
      </div>`;
  }
  const d = claimDraft(c, edits);
  const total = d.quantity * d.each;
  // Points already spent at claim time count toward the total.
  const short = total - c.cost - (p.points || 0);
  const pts = n => `${n} ${n === 1 ? 'point' : 'points'}`;
  const sub = c.type === 'flexible'
    ? `${esc(p.name)} has ${pts(p.points || 0)}`
    : `${esc(p.name)} asked for ${esc(unitAmount(c.quantity, c.unit, c.unitMinutes))} and spent ${pts(c.cost)}`;
  const editor = c.type === 'flexible'
    ? `
        <div class="claim-edit">
          <span class="claim-edit-label">Points</span>
          ${stepBtn(c, 'each', -10, 'Take off 10 points', d.each < 10)}
          ${stepBtn(c, 'each', -1, 'Take off 1 point', d.each < 1)}
          <b class="claim-edit-val">${d.each}</b>
          ${stepBtn(c, 'each', 1, 'Add 1 point')}
          ${stepBtn(c, 'each', 10, 'Add 10 points')}
        </div>`
    : `
        <div class="claim-edit">
          <span class="claim-edit-label">How many</span>
          ${stepBtn(c, 'quantity', -1, 'One less', d.quantity <= 1)}
          <b class="claim-edit-val">${d.quantity}</b>
          ${stepBtn(c, 'quantity', 1, 'One more')}
          <span class="claim-edit-label">Points each</span>
          ${stepBtn(c, 'each', -1, 'One point less each', d.each < 1)}
          <b class="claim-edit-val">${d.each}</b>
          ${stepBtn(c, 'each', 1, 'One point more each')}
        </div>`;
  const summary = c.type === 'flexible'
    ? `Take ${pts(total)}`
    : `${esc(unitAmount(d.quantity, c.unit, c.unitMinutes))} for ${pts(total)}`;
  return `
    <div class="adjust claim-flex">
      <div class="claim-flex-top">
        ${avatar(p, 40)}
        <div class="claim-body" style="flex:1"><b>${esc(claimLabel(c))}</b><span>${sub}</span></div>
      </div>
      ${editor}
      <div class="claim-flex-top">
        <span class="claim-total" style="flex:1">${summary}${short > 0 ? ` <span class="form-error" style="display:inline">Needs ${short} more</span>` : ''}</span>
        ${decline}
        <button type="button" class="btn-approve" data-action="approve-claim" data-id="${esc(c.id)}" ${short > 0 ? 'disabled' : ''}>Approve</button>
      </div>
    </div>`;
}

// The points a parent will give each person for a late task: their edits so
// far, or 0.
export function lateTaskDraft(task, edits = {}) {
  const d = edits['task:' + task.id];
  return d ? d.each : 0;
}

function lateStepBtn(t, delta, label, disabled) {
  return `<button type="button" class="step" data-action="late-task-edit" data-id="${esc(t.id)}" data-delta="${delta}" ${disabled ? 'disabled' : ''} aria-label="${label}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</button>`;
}

function pendingTaskRow(t, who, edits) {
  const first = who[0] || { name: '?', color: 'var(--muted)' };
  const names = esc(who.map(p => p.name).join(' and ') || '?');
  const each = who.length > 1 ? ' each' : '';
  const buttons = `
        <button type="button" class="btn-outline small" data-action="decide-task" data-id="${esc(t.id)}" data-status="denied">Not done</button>
        <button type="button" class="btn-approve" data-action="decide-task" data-id="${esc(t.id)}" data-status="approved">Approve</button>`;
  if (!tickedLate(t)) {
    return `
      <div class="adjust">
        ${avatar(first, 40)}
        <div class="claim-body" style="flex:1"><b>${esc(t.title)}</b><span>${names} · +${t.points}${each}</span></div>
        ${buttons}
      </div>`;
  }
  const award = lateTaskDraft(t, edits);
  const pts = n => `${n} ${n === 1 ? 'point' : 'points'}`;
  return `
    <div class="adjust claim-flex">
      <div class="claim-flex-top">
        ${avatar(first, 40)}
        <div class="claim-body" style="flex:1"><b>${esc(t.title)}</b><span>${names} · done late, worth +${t.points}${each} on time</span></div>
      </div>
      <div class="claim-edit">
        <span class="claim-edit-label">Points</span>
        ${lateStepBtn(t, -1, 'One point less', award < 1)}
        <b class="claim-edit-val">${award}</b>
        ${lateStepBtn(t, 1, 'One point more')}
        <button type="button" class="btn-outline small" data-action="late-task-full" data-id="${esc(t.id)}" ${award === t.points ? 'disabled' : ''}>Full points</button>
        <button type="button" class="btn-outline small" data-action="late-task-none" data-id="${esc(t.id)}" ${award === 0 ? 'disabled' : ''}>No points</button>
      </div>
      <div class="claim-flex-top">
        <span class="claim-total" style="flex:1">Give ${pts(award)}${each}</span>
        ${buttons}
      </div>
    </div>`;
}

function controls({ people, claims, approvalHabits = [], pendingTasks = [], log, edits = {} }) {
  const byId = new Map(people.map(p => [p.id, p]));
  const pending = claims.filter(c => c.status === 'pending');
  const ticks = pendingHabitTicks(approvalHabits);
  return `
    <div class="stack" style="gap:22px">
      <div class="dialog-head">
        <h2>Parent controls</h2>
        <button type="button" class="btn-dark" data-action="close-parents">Lock and close</button>
      </div>
      <section class="stack" style="gap:10px">
        <h3>Adjust points</h3>
        ${people.map(p => `
          <div class="adjust">
            ${avatar(p, 40)}
            <span class="adjust-name">${esc(p.name)}</span>
            <span class="adjust-pts">${p.points} pts</span>
            <button type="button" class="step" data-action="adjust" data-id="${esc(p.id)}" data-delta="-5" aria-label="Take 5 points from ${esc(p.name)}">−5</button>
            <button type="button" class="step" data-action="adjust" data-id="${esc(p.id)}" data-delta="5" aria-label="Give ${esc(p.name)} 5 points">+5</button>
            <button type="button" class="step" data-action="adjust" data-id="${esc(p.id)}" data-delta="10" aria-label="Give ${esc(p.name)} 10 points">+10</button>
          </div>`).join('') || '<p class="note">No one is set up yet.</p>'}
      </section>
      ${pendingTasks.length ? `
        <section class="stack" style="gap:10px">
          <h3>Tasks waiting for OK</h3>
          ${[...pendingTasks].sort((a, b) => a.pendingAt - b.pendingAt).map(t =>
            pendingTaskRow(t, t.personIds.map(id => byId.get(id)).filter(Boolean), edits)).join('')}
        </section>` : ''}
      ${ticks.length ? `
        <section class="stack" style="gap:10px">
          <h3>Habits waiting for OK</h3>
          ${ticks.map(({ habit: h, day }) => {
            const p = byId.get(h.personId) || { name: '?', color: 'var(--muted)' };
            const pts = Number.isInteger(h.points) ? h.points : 2;
            return `
              <div class="adjust">
                ${avatar(p, 40)}
                <div class="claim-body" style="flex:1"><b>${esc(h.name)}</b><span>${esc(p.name)} · ${esc(dayName(day))} · +${pts}</span></div>
                <button type="button" class="btn-outline small" data-action="decide-habit" data-id="${esc(h.id)}" data-day="${esc(day)}" data-status="denied">Not done</button>
                <button type="button" class="btn-approve" data-action="decide-habit" data-id="${esc(h.id)}" data-day="${esc(day)}" data-status="approved">Approve</button>
              </div>`;
          }).join('')}
        </section>` : ''}
      <section class="stack" style="gap:10px">
        <h3>Rewards waiting for OK</h3>
        ${!pending.length ? '<p class="note" style="font-size:15px">Nothing waiting right now.</p>' : pending.map(c =>
          claimRow(c, byId.get(c.personId) || { name: '?', color: 'var(--muted)', points: 0 }, edits)).join('')}
      </section>
      ${log.length ? `
        <section class="stack" style="gap:6px">
          <h3>Changes this visit</h3>
          ${log.map(l => `<div class="note" style="font-size:15px;color:var(--ink-2)">${esc(l)}</div>`).join('')}
        </section>` : ''}
    </div>`;
}

export function renderParents(s) {
  return `
    <div class="scrim">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Parent controls">
        ${s.unlocked ? controls(s) : pinPad(s)}
      </div>
    </div>`;
}
