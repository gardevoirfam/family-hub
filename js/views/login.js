import { esc } from '../ui.js';

export function renderLogin(root, { onSubmit, error = '', busy = false, username = '' }) {
  root.innerHTML = `
    <div class="login">
      <div class="login-brand">
        <div class="logo">FH</div>
        <div>
          <h1>Family Hub</h1>
          <p>Our plans, tasks and rewards, all in one place.</p>
        </div>
        <div class="foot">Stays signed in on this iPad.</div>
      </div>
      <div class="login-main">
        <form novalidate>
          <h2>Sign in</h2>
          <p class="lede">A grown-up signs in once and the hub stays open for everyone.</p>
          <label class="field" for="hub-username">Username
            <input id="hub-username" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="family" value="${esc(username)}" required>
          </label>
          <label class="field" for="hub-password">Password
            <input id="hub-password" name="password" type="password" autocomplete="current-password" required>
          </label>
          ${error ? `<div class="form-error" role="alert">${esc(error)}</div>` : ''}
          <button class="btn-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>`;

  const form = root.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    onSubmit(username, password);
  });
  if (!busy) (username ? form.password : form.username).focus();
}
