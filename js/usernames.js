import { USERNAME_DOMAIN } from './config.js';

// Firebase email/password auth needs an email; a plain username gets the domain added.
export function toEmail(username) {
  const u = username.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${USERNAME_DOMAIN}`;
}
