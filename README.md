# Family Hub

The family's chores, habits, events and rewards on one page, made for an iPad
pinned to the home screen. Plain HTML, CSS and JavaScript with the Firebase web
SDK: no build step, so GitHub Pages serves the repository as is.

- **Live site:** https://gardevoirfam.github.io/family-hub/
- **Preview with sample data (no sign-in):** https://gardevoirfam.github.io/family-hub/?demo

## How it fits together

| Piece | Where |
|-------|-------|
| Firebase project config | `js/config.js` |
| Sign-in, routing, app shell | `js/app.js` |
| Pages | `js/views/` |
| Firestore reads/writes | `js/source-firebase.js` (`js/source-demo.js` for `?demo`) |
| Database schema | `docs/data-model.md` |
| Access rules | kept privately, not in this repository |
| Claude task script (repeating jobs, calendar copy) | `tools/hubtask.py` |

## Logins

Sign-in is username + password. Firebase needs an email, so a username is turned
into `<username>@familyhub.local` behind the scenes (the domain is set in
`js/config.js`); typing a full email also works. The actual usernames are not
stored in this repository.

There are two logins, and each one's role lives in Firestore, not in the code:
a `roles/{User UID}` document with `role: "hub"` for the iPad (reads, plus small
writes like ticking jobs and claiming rewards) or `role: "task"` for the
recurring Claude task (creates and edits everything). The rules are kept privately.

## The Claude task

A daily Claude routine runs `tools/hubtask.py` (Python standard library only). It
signs in with `FAMILYHUB_TASK_USER` and `FAMILYHUB_TASK_PASSWORD` from the cloud
environment, never from this repository.

- `python3 tools/hubtask.py generate` creates the jobs from the chore schedule
  (`settings/schedule`) that open in the next two days. Running it twice is safe.
- `python3 tools/hubtask.py schedule get` / `schedule set FILE` reads or replaces
  the chore schedule.
- `python3 tools/hubtask.py events set FILE` copies Google Calendar events (a JSON
  list of `{id, title, place, notes, start, allDay, who}`) into `events`.

- `python3 tools/hubtask.py digest set FILE` replaces the weekly digest at the
  bottom of the home page (`settings/digest`).

Add `--dry-run` to see what would change.

## Running locally

Serve the folder with any static server, for example `npx http-server .`, then
open http://localhost:8080/?demo for sample data, or without `?demo` to sign in.

## Deploying

- **Site:** GitHub Pages, deploying from the `main` branch, root folder.
- **Rules:** kept privately; paste them into Firebase console > Firestore Database > Rules and publish.
