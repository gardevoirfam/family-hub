# Family Hub data model

All data lives in Cloud Firestore in the `familyhub-10926` project. The Claude task
login creates and edits content; the iPad login reads it and makes small writes.
The Firestore rules (kept privately) enforce exactly which fields the iPad may change.

Dates are Firestore `Timestamp`s. Document ids are free-form unless noted; short
readable ids (for example `maya`) make the data easier to work with.

## `people/{personId}`

| Field    | Type   | Notes |
|----------|--------|-------|
| `name`   | string | Shown in the nav and on cards. |
| `order`  | number | Sort order in the nav (lowest first). |
| `color`  | string | Optional `#RRGGBB`. A palette color is used when missing. |
| `soft`   | string | Optional light tint `#RRGGBB` for backgrounds. Derived from `color` when missing. |
| `points` | int    | Current balance. The iPad may change it (never below 0). |
| `streak` | int    | Longest current habit streak, in weeks. The iPad may change it. |

## `tasks/{taskId}`

| Field      | Type      | Notes |
|------------|-----------|-------|
| `personId` | string    | Id of a `people` document. Leave empty for a shared job. |
| `personIds`| string[]  | Optional. For a shared job, everyone it belongs to, e.g. `["evelyn", "wesley"]`. It shows on each of their pages and one tick gives every one of them the full points. |
| `title`    | string    | |
| `start`    | timestamp | Optional. When the job opens, for a job with a window such as Friday to Sunday. It shows under Today for every day of the window. |
| `due`      | timestamp | When the task is due (the end of the window). On time means done before this. Leave it out for an any-time or repeating task (full points whenever it's done). |
| `points`   | int       | Full value. Late jobs are worth 0. |
| `done`     | bool      | **Must be set** (use `false` for new tasks); the home page queries on it. The iPad may change it. |
| `doneAt`   | timestamp | Set when ticked done, `null` otherwise. The iPad may change it. |
| `cooldownDays` | number | Optional. Makes a **repeating** task: it has no `due`, can be done any time, and after each completion it rests for this many days (fractions allowed) before it can be done again. One document is reused; every completion is in `pointsLog`. |
| `needsApproval` | bool | Optional. Ticking sets `pendingAt` instead of `done`; a grown-up approves it in the Parents panel, which pays the points (judged by when it was ticked) and starts any cooldown then. |
| `pendingAt` | timestamp | Set by the iPad while waiting for approval, `null` otherwise. |
| `choreId`  | string    | Set on jobs made from the chore schedule (see `settings/schedule`). Their id is `<choreId>-<due date>`. |

## `habits/{habitId}`

| Field      | Type   | Notes |
|------------|--------|-------|
| `personId` | string | Id of a `people` document. |
| `name`     | string | |
| `order`    | number | Optional sort order on the person page. |
| `points`   | int    | Optional. Points per tick (default 2). |
| `perWeek`  | int    | Optional. Ticks needed per Monday-to-Sunday week, 1 to 7 (default: every day, or every day in `weekdays`). Each habit has its own streak: weeks in a row in which it met its goal (shown with a flame next to the habit). |
| `weekdays` | string[] | Optional. The days the habit is for, e.g. `["sat"]` or `["mon", "wed", "fri"]`. It can only be ticked on those days; other days are blank. Without it, every day. `perWeek` defaults to the number of these days. |
| `needsApproval` | bool | Optional. When `true`, a tick is saved as `"pending"` in `days` and earns nothing until a grown-up approves it in the Parents panel (then it becomes `true` and the points, plus any bonus, are paid). Declining clears it. |
| `bonus`    | int    | Optional. Extra points earned by the tick that meets this habit's weekly goal (default 0, no bonus). Doubled (not compounding) when the habit also met its goal the week before, e.g. 4, 8, 8. Unticking that day takes it back. |
| `days`     | map    | Keys are local dates `YYYY-MM-DD`, value `true` when done (or `"pending"` while waiting for approval), or `"saved"` for a missed day filled in with 4 points (counts toward the goal, streak and bonus; one per person per week, across all habits, logged as "Streak save: ..."). The iPad may change it. |

## `events/{eventId}`

| Field    | Type      | Notes |
|----------|-----------|-------|
| `title`  | string    | |
| `place`  | string    | Optional second line (a place or a note like "Bring the blue book"). |
| `notes`  | string    | Optional details shown when the event is tapped on the home page, such as gear to bring. Line breaks are kept. |
| `start`  | timestamp | Start time. For all-day events use local midnight and set `allDay`. |
| `allDay` | bool      | Optional. |
| `who`    | string[]  | Person ids. Empty (or `["all"]`) means everyone. |
| `source` | string    | `calendar` for events copied from Google Calendar (id `cal-<calendar event id>`). The copy step updates and removes only these. |

## `rewards/{rewardId}`

Written with `tools/hubtask.py rewards set FILE` (a JSON list of these, each with its `id`).

| Field    | Type   | Notes |
|----------|--------|-------|
| `title`  | string | |
| `detail` | string | |
| `type`   | string | `fixed` (default), `flexible` or `perUnit`. |
| `cost`   | int    | `fixed`: points needed. `flexible`: optional starting suggestion for the parent (default 0). `perUnit`: points per unit. |
| `unit`   | string | `perUnit` only: what one unit is, e.g. `15 minutes`. |
| `unitMinutes` | int | Optional, `perUnit` only: minutes in one unit, so totals read "1 hour 15 minutes". |
| `maxQty` | int    | Optional, `perUnit` only: most units in one claim (default 20). |
| `order`  | int    | Optional sort order on the Rewards page (then by cost). |
| `weekly` | bool   | Optional. `true` for the 4 rotating "This week's rewards" slots, shown in their own group at the top of the Rewards page. The weekly reward routine replaces these every Monday and leaves the others alone. |
| `active` | bool   | Hidden when `false`. |

- **fixed**: claiming spends `cost` right away; declining gives it back.
- **flexible** (e.g. a Pokémon pack): claiming spends nothing. In the Parents panel a
  grown-up sets the points to take, then approves; the points come off then.
- **perUnit** (e.g. screen time, 1 point = 15 minutes): the kid picks how many units and
  claiming spends `quantity × cost`. When approving, a grown-up can change the quantity
  and the points per unit; the difference is taken or given back.

## `claims/{claimId}`

Created by the iPad when someone claims a reward.

| Field       | Type      | Notes |
|-------------|-----------|-------|
| `personId`  | string    | |
| `rewardId`  | string    | |
| `title`     | string    | Copied from the reward. |
| `cost`      | int       | Points spent so far (0 for a flexible claim until approved); the final amount once approved. |
| `type`      | string    | `flexible` or `perUnit`; missing for fixed claims. |
| `quantity`  | int       | Flexible and per-unit claims: units asked for (1 for flexible); the approved amount once approved. |
| `each`      | int       | Flexible and per-unit claims: points per unit (for flexible, the points). |
| `unit`, `unitMinutes` | string, int | Per-unit claims: copied from the reward. |
| `status`    | string    | `pending`, then `approved` or `denied`. |
| `createdAt` | timestamp | |
| `decidedAt` | timestamp | Set when a parent decides. |

## `pointsLog/{entryId}`

Append-only history written next to every point change.

The person page sums it into points earned this week and the average per week over the previous 4 full weeks (Monday to Sunday). Entries whose `reason` starts with `Claimed`, `Returned` or `Reward` are reward spending and don't count as earned.

| Field      | Type      | Notes |
|------------|-----------|-------|
| `personId` | string    | |
| `delta`    | int       | Positive or negative. |
| `reason`   | string    | For example "Feed the cat (on time)". |
| `at`       | timestamp | |

## `settings/{settingId}`

App settings, written by the Claude task login.

`settings/parent`: `pinHash` (hex SHA-256 of `<pinSalt>:<pin>`) and `pinSalt` (random hex). Unlocks the Parents controls on the iPad.

`settings/schedule`: the repeating chores. `tools/hubtask.py generate` turns it into
`tasks`, and `tools/hubtask.py schedule set FILE` replaces it after checking it.

```json
{
  "timezone": "America/Toronto",
  "chores": [
    { "id": "laundry", "title": "Laundry", "personIds": ["evelyn", "wesley"], "points": 10,
      "repeat": "weekly", "opens": "fri 00:00", "due": "sun 20:00" },
    { "id": "dishwasher", "title": "Unload the dishwasher", "personIds": ["wesley"], "points": 5,
      "repeat": "daily", "due": "19:00", "days": ["mon", "wed", "fri"] }
  ]
}
```

- `id`: lowercase letters, digits and dashes; used in each job's id.
- `repeat`: `daily` (optional `days` limits it to those weekdays) or `weekly`.
- `due`: `HH:MM` for daily chores, `<day> HH:MM` for weekly ones. `opens` (weekly only) gives the job a window, such as Friday to Sunday.
- `paused`: optional; `true` stops new copies without deleting the chore.

`settings/digest`: the weekly summary shown at the bottom of the home page, written
by the Weekly Digest routine with `tools/hubtask.py digest set FILE`. The card is
hidden when there are no sections.

```json
{
  "title": "Week of Sun Oct 4",
  "updatedAt": "<timestamp, set by the script>",
  "sections": [
    { "heading": "Heads up", "items": [{ "when": "Fri Oct 9", "text": "No school: PA day" }] },
    { "heading": "Usual schedule", "items": [{ "when": "Mon & Thu, 5pm", "text": "Taekwondo" }] },
    { "heading": "Action items", "items": [{ "when": "", "text": "Register for School Cash Online" }] }
  ]
}
```

## `roles/{uid}`

One document per login, named by its User UID from Firebase console > Authentication.
Created by hand in the console; the app can't write here.

| Field  | Type   | Notes |
|--------|--------|-------|
| `role` | string | `hub` for the iPad, `task` for the Claude task. |
