#!/usr/bin/env python3
"""Family Hub data task: run by the recurring Claude routine.

Signs in as the Claude task login and writes to Firestore over REST. Only the
Python standard library is needed.

The login comes from the environment, never from this repo:
  FAMILYHUB_TASK_USER       username (or full email) of the task login
  FAMILYHUB_TASK_PASSWORD   its password

Commands:
  generate [--days N] [--dry-run]   create the jobs that open within the next N days
                                    (default 2) from the chore schedule in settings/schedule
  schedule get                      print the chore schedule as JSON
  schedule set FILE [--dry-run]     replace the chore schedule with FILE (JSON)
  events set FILE [--dry-run]       make the hub's upcoming calendar events match
                                    FILE (JSON list copied from Google Calendar)
  digest set FILE [--dry-run]       replace the weekly digest on the home page
                                    with FILE (JSON: title and sections)
  rewards get                       print the rewards catalog as JSON
  rewards set FILE [--dry-run]      make the rewards catalog match FILE (JSON list);
                                    rewards not in FILE are removed

The schedule format is described in docs/data-model.md. Generated jobs get the
id "<chore id>-<due date>", so running generate again never makes duplicates,
and a job a parent deleted by hand comes back only if it is still upcoming.

For testing, FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST point the
script at the Firebase emulators.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
DEFAULT_TZ = 'America/Toronto'


def read_config():
    with open(os.path.join(ROOT, 'js', 'config.js')) as f:
        src = f.read()
    def field(name):
        m = re.search(name + r"\s*[:=]\s*'([^']+)'", src)
        if not m:
            sys.exit(f'Could not find {name} in js/config.js')
        return m.group(1)
    return field('apiKey'), field('projectId'), field('USERNAME_DOMAIN')


# ---- REST helpers ---------------------------------------------------------

def http(method, url, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except ValueError:
            return e.code, {}


class Hub:
    def __init__(self):
        self.api_key, self.project, self.domain = read_config()
        emu = os.environ.get('FIRESTORE_EMULATOR_HOST')
        host = f'http://{emu}' if emu else 'https://firestore.googleapis.com'
        self.docs = f'{host}/v1/projects/{self.project}/databases/(default)/documents'
        self.token = None

    def sign_in(self):
        user = os.environ.get('FAMILYHUB_TASK_USER')
        password = os.environ.get('FAMILYHUB_TASK_PASSWORD')
        if not user or not password:
            sys.exit('Set FAMILYHUB_TASK_USER and FAMILYHUB_TASK_PASSWORD to sign in as the task login.')
        email = user if '@' in user else f'{user}@{self.domain}'
        emu = os.environ.get('FIREBASE_AUTH_EMULATOR_HOST')
        base = f'http://{emu}/identitytoolkit.googleapis.com' if emu else 'https://identitytoolkit.googleapis.com'
        status, res = http('POST', f'{base}/v1/accounts:signInWithPassword?key={self.api_key}',
                           {'email': email, 'password': password, 'returnSecureToken': True})
        if status != 200:
            sys.exit(f"Sign-in failed: {res.get('error', {}).get('message', status)}")
        self.token = res['idToken']

    def get(self, path):
        status, res = http('GET', f'{self.docs}/{path}', token=self.token)
        if status == 404:
            return None
        if status != 200:
            sys.exit(f'Reading {path} failed ({status}): {error_text(res)}')
        return decode_fields(res.get('fields', {}))

    def set(self, path, data):
        status, res = http('PATCH', f'{self.docs}/{path}', {'fields': encode_fields(data)}, self.token)
        if status != 200:
            sys.exit(f'Writing {path} failed ({status}): {error_text(res)}')

    def list(self, collection):
        docs, token = [], ''
        while True:
            url = f'{self.docs}/{collection}?pageSize=300' + (f'&pageToken={token}' if token else '')
            status, res = http('GET', url, token=self.token)
            if status != 200:
                sys.exit(f'Listing {collection} failed ({status}): {error_text(res)}')
            for d in res.get('documents', []):
                docs.append((d['name'].rsplit('/', 1)[1], decode_fields(d.get('fields', {}))))
            token = res.get('nextPageToken')
            if not token:
                return docs

    def delete(self, path):
        status, res = http('DELETE', f'{self.docs}/{path}', token=self.token)
        if status != 200:
            sys.exit(f'Deleting {path} failed ({status}): {error_text(res)}')

    def create(self, collection, doc_id, data):
        """Creates a document. Returns False when it already exists."""
        status, res = http('POST', f'{self.docs}/{collection}?documentId={doc_id}',
                           {'fields': encode_fields(data)}, self.token)
        if status == 409:
            return False
        if status != 200:
            sys.exit(f'Creating {collection}/{doc_id} failed ({status}): {error_text(res)}')
        return True


def error_text(res):
    return res.get('error', {}).get('message', json.dumps(res)[:200])


def encode(v):
    if v is None:
        return {'nullValue': None}
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if isinstance(v, float):
        return {'doubleValue': v}
    if isinstance(v, str):
        return {'stringValue': v}
    if isinstance(v, dt.datetime):
        return {'timestampValue': v.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')}
    if isinstance(v, (list, tuple)):
        return {'arrayValue': {'values': [encode(x) for x in v]}}
    if isinstance(v, dict):
        return {'mapValue': {'fields': encode_fields(v)}}
    raise TypeError(f'Cannot store {type(v).__name__}')


def encode_fields(d):
    return {k: encode(v) for k, v in d.items()}


def decode(v):
    if 'nullValue' in v:
        return None
    if 'booleanValue' in v:
        return v['booleanValue']
    if 'integerValue' in v:
        return int(v['integerValue'])
    if 'doubleValue' in v:
        return v['doubleValue']
    if 'stringValue' in v:
        return v['stringValue']
    if 'timestampValue' in v:
        return v['timestampValue']
    if 'arrayValue' in v:
        return [decode(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v:
        return decode_fields(v['mapValue'].get('fields', {}))
    return None


def decode_fields(f):
    return {k: decode(v) for k, v in f.items()}


# ---- Schedule -------------------------------------------------------------

def parse_time(s):
    h, m = s.split(':')
    return dt.time(int(h), int(m))


def parse_day_time(s):
    """'sun 20:00' -> (6, time(20, 0))"""
    day, time = s.split()
    return DAYS.index(day.lower()[:3]), parse_time(time)


def check_schedule(schedule):
    """Returns a list of problems; empty when the schedule is valid."""
    problems = []
    try:
        ZoneInfo(schedule.get('timezone') or DEFAULT_TZ)
    except Exception:
        problems.append(f"unknown timezone {schedule.get('timezone')!r}")
    ids = set()
    for i, c in enumerate(schedule.get('chores', [])):
        name = c.get('id') or f'chore #{i + 1}'
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', c.get('id', '')):
            problems.append(f'{name}: id must be lowercase letters, digits and dashes')
        if c.get('id') in ids:
            problems.append(f'{name}: id is used twice')
        ids.add(c.get('id'))
        if not c.get('title'):
            problems.append(f'{name}: missing title')
        if not isinstance(c.get('points'), int) or c['points'] < 0:
            problems.append(f'{name}: points must be a whole number')
        if not c.get('personIds'):
            problems.append(f'{name}: personIds must list at least one person')
        try:
            if c.get('repeat') == 'daily':
                parse_time(c['due'])
                for d in c.get('days', []):
                    DAYS.index(d.lower()[:3])
            elif c.get('repeat') == 'weekly':
                parse_day_time(c['due'])
                if c.get('opens'):
                    parse_day_time(c['opens'])
            else:
                problems.append(f'{name}: repeat must be "daily" or "weekly"')
        except (KeyError, ValueError):
            problems.append(f'{name}: due/opens/days are not in the right format')
    return problems


def occurrences(chore, tz, now, until):
    """Yields (start or None, due) for each copy of a chore that is not yet due and
    opens by `until`. A job opens at its start, or at midnight on its due day."""
    day = now.astimezone(tz).date()
    last = until.astimezone(tz).date() + dt.timedelta(days=7)
    while day <= last:
        start = None
        if chore['repeat'] == 'daily':
            days = [DAYS.index(d.lower()[:3]) for d in chore.get('days', [])]
            due = dt.datetime.combine(day, parse_time(chore['due']), tz) if not days or day.weekday() in days else None
        else:
            due_day, due_time = parse_day_time(chore['due'])
            due = dt.datetime.combine(day, due_time, tz) if day.weekday() == due_day else None
            if due and chore.get('opens'):
                open_day, open_time = parse_day_time(chore['opens'])
                back = (due_day - open_day) % 7
                start = dt.datetime.combine(day - dt.timedelta(days=back), open_time, tz)
        opens = start or (dt.datetime.combine(due.date(), dt.time(0, 0), tz) if due else None)
        if due and now < due and opens <= until:
            yield start, due
        day += dt.timedelta(days=1)


def build_job(chore, start, due):
    people = list(chore['personIds'])
    job = {
        'title': chore['title'],
        'personId': people[0] if len(people) == 1 else '',
        'personIds': people,
        'due': due,
        'points': chore['points'],
        'done': False,
        'doneAt': None,
        'choreId': chore['id'],
    }
    if start:
        job['start'] = start
    return job


# ---- Commands -------------------------------------------------------------

def cmd_generate(hub, args):
    schedule = hub.get('settings/schedule') or {}
    problems = check_schedule(schedule)
    if problems:
        sys.exit('The chore schedule has problems:\n  ' + '\n  '.join(problems))
    tz = ZoneInfo(schedule.get('timezone') or DEFAULT_TZ)
    now = dt.datetime.now(tz)
    until = now + dt.timedelta(days=args.days)
    made = kept = 0
    for chore in schedule.get('chores', []):
        if chore.get('paused'):
            continue
        for start, due in occurrences(chore, tz, now, until):
            doc_id = f"{chore['id']}-{due.date().isoformat()}"
            when = due.strftime('%a %b %d %H:%M')
            if args.dry_run:
                print(f'would create {doc_id}: {chore["title"]} due {when}')
                made += 1
            elif hub.create('tasks', doc_id, build_job(chore, start, due)):
                print(f'created {doc_id}: {chore["title"]} due {when}')
                made += 1
            else:
                kept += 1
    verb = 'Would create' if args.dry_run else 'Created'
    print(f'{verb} {made} job(s); {kept} already existed. Schedule has {len(schedule.get("chores", []))} chore(s).')


def parse_when(s, tz):
    """'2026-10-09' (all day, local midnight) or an ISO date-time."""
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        return dt.datetime.combine(dt.date.fromisoformat(s), dt.time(0, 0), tz), True
    t = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    return (t if t.tzinfo else t.replace(tzinfo=tz)), False


def cmd_events(hub, args):
    """Copies calendar events into the hub. Each calendar event becomes events/cal-<id>
    with source "calendar"; upcoming calendar copies missing from FILE are removed.
    Events added to the hub some other way are never touched."""
    with open(args.file) as f:
        items = json.load(f)
    schedule = hub.get('settings/schedule') or {}
    tz = ZoneInfo(schedule.get('timezone') or DEFAULT_TZ)
    now = dt.datetime.now(tz)
    today = dt.datetime.combine(now.date(), dt.time(0, 0), tz)
    wanted = {}
    for e in items:
        if not e.get('id') or not e.get('title') or not e.get('start'):
            sys.exit(f'Each event needs id, title and start: {json.dumps(e)[:120]}')
        start, all_day = parse_when(e['start'], tz)
        doc_id = 'cal-' + re.sub(r'[^A-Za-z0-9_-]', '_', e['id'])[:120]
        wanted[doc_id] = {
            'title': e['title'],
            'place': e.get('place') or '',
            'notes': str(e.get('notes') or ''),
            'start': start,
            'allDay': bool(e.get('allDay', all_day)),
            'who': list(e.get('who') or []),
            'source': 'calendar',
        }
    existing = {i: d for i, d in hub.list('events') if d.get('source') == 'calendar'}
    stale = [i for i, d in existing.items()
             if i not in wanted and d.get('start') and parse_when(d['start'], tz)[0] >= today]
    for doc_id, data in wanted.items():
        print(('would save ' if args.dry_run else 'saved ') + f"{doc_id}: {data['title']} {data['start'].strftime('%a %b %d %H:%M')}")
        if not args.dry_run:
            hub.set(f'events/{doc_id}', data)
    for doc_id in stale:
        print(('would remove ' if args.dry_run else 'removed ') + f"{doc_id}: {existing[doc_id].get('title')}")
        if not args.dry_run:
            hub.delete(f'events/{doc_id}')
    print(f'{len(wanted)} calendar event(s) saved, {len(stale)} removed' + (' (dry run)' if args.dry_run else '') + '.')


def cmd_digest(hub, args):
    """Saves the weekly digest shown at the bottom of the home page."""
    with open(args.file) as f:
        digest = json.load(f)
    problems = []
    if not isinstance(digest.get('sections'), list) or not digest['sections']:
        problems.append('sections must be a non-empty list')
    else:
        for n, s in enumerate(digest['sections'], 1):
            if not isinstance(s, dict) or not isinstance(s.get('items'), list):
                problems.append(f'section {n} needs a heading and an items list')
                continue
            for i in s['items']:
                if not isinstance(i, dict) or not i.get('text'):
                    problems.append(f"section {n} ({s.get('heading', '')}): each item needs text (and optional when)")
                    break
    if problems:
        sys.exit('Not saved. Problems:\n  ' + '\n  '.join(problems))
    clean = {
        'title': str(digest.get('title') or 'This week'),
        'sections': [{
            'heading': str(s.get('heading') or ''),
            'items': [{'when': str(i.get('when') or ''), 'text': str(i['text'])} for i in s['items']],
        } for s in digest['sections']],
        'updatedAt': dt.datetime.now(dt.timezone.utc),
    }
    count = sum(len(s['items']) for s in clean['sections'])
    if args.dry_run:
        print(f"Digest is valid ({len(clean['sections'])} section(s), {count} item(s)); not saved.")
        return
    hub.set('settings/digest', clean)
    print(f"Saved digest \"{clean['title']}\" with {len(clean['sections'])} section(s), {count} item(s).")


REWARD_TYPES = ('fixed', 'flexible', 'perUnit')


def check_rewards(rewards):
    if not isinstance(rewards, list):
        return ['the file must be a JSON list of rewards']
    problems, seen = [], set()
    for n, r in enumerate(rewards, 1):
        if not isinstance(r, dict):
            problems.append(f'reward {n} must be an object')
            continue
        name = r.get('id') or f'reward {n}'
        if not re.fullmatch(r'[a-z0-9-]+', str(r.get('id') or '')):
            problems.append(f'{name}: id must be lowercase letters, digits and dashes')
        elif r['id'] in seen:
            problems.append(f'{name}: id used twice')
        seen.add(r.get('id'))
        if not r.get('title'):
            problems.append(f'{name}: needs a title')
        kind = r.get('type', 'fixed')
        if kind not in REWARD_TYPES:
            problems.append(f'{name}: type must be one of {", ".join(REWARD_TYPES)}')
        cost = r.get('cost')
        if kind == 'fixed' and not (isinstance(cost, int) and cost > 0):
            problems.append(f'{name}: a fixed reward needs a whole-number cost above 0')
        if kind == 'perUnit':
            if not (isinstance(cost, int) and cost > 0):
                problems.append(f'{name}: a per-unit reward needs cost (points per unit) above 0')
            if not r.get('unit'):
                problems.append(f'{name}: a per-unit reward needs a unit, e.g. "15 minutes"')
        if kind == 'flexible' and cost is not None and not (isinstance(cost, int) and cost >= 0):
            problems.append(f'{name}: cost (the suggested points) must be a whole number')
        for k in ('unitMinutes', 'maxQty', 'order'):
            if k in r and not (isinstance(r[k], int) and r[k] >= 0):
                problems.append(f'{name}: {k} must be a whole number')
    return problems


def cmd_rewards(hub, args):
    if args.action == 'get':
        print(json.dumps([{'id': i, **d} for i, d in hub.list('rewards')], indent=2, default=str))
        return
    if not args.file:
        sys.exit('rewards set needs a JSON file')
    with open(args.file) as f:
        rewards = json.load(f)
    problems = check_rewards(rewards)
    if problems:
        sys.exit('Not saved. Problems:\n  ' + '\n  '.join(problems))
    keys = ('title', 'detail', 'type', 'cost', 'unit', 'unitMinutes', 'maxQty', 'order')
    wanted = {}
    for r in rewards:
        data = {k: r[k] for k in keys if k in r}
        data.setdefault('detail', '')
        data.setdefault('type', 'fixed')
        data.setdefault('cost', 0)
        data['active'] = r.get('active', True) is not False
        wanted[r['id']] = data
    stale = [i for i, _ in hub.list('rewards') if i not in wanted]
    for doc_id, data in wanted.items():
        print(('would save ' if args.dry_run else 'saved ') + f"{doc_id}: {data['title']} ({data['type']})")
        if not args.dry_run:
            hub.set(f'rewards/{doc_id}', data)
    for doc_id in stale:
        print(('would remove ' if args.dry_run else 'removed ') + doc_id)
        if not args.dry_run:
            hub.delete(f'rewards/{doc_id}')
    print(f'{len(wanted)} reward(s) saved, {len(stale)} removed' + (' (dry run)' if args.dry_run else '') + '.')


def cmd_schedule(hub, args):
    if args.action == 'get':
        print(json.dumps(hub.get('settings/schedule') or {'timezone': DEFAULT_TZ, 'chores': []}, indent=2))
        return
    if not args.file:
        sys.exit('schedule set needs a JSON file')
    with open(args.file) as f:
        schedule = json.load(f)
    problems = check_schedule(schedule)
    if problems:
        sys.exit('Not saved. Problems:\n  ' + '\n  '.join(problems))
    if args.dry_run:
        print(f"Schedule is valid ({len(schedule.get('chores', []))} chore(s)); not saved.")
        return
    hub.set('settings/schedule', schedule)
    print(f"Saved schedule with {len(schedule.get('chores', []))} chore(s).")


def main():
    p = argparse.ArgumentParser(description='Family Hub data task')
    sub = p.add_subparsers(dest='cmd', required=True)
    g = sub.add_parser('generate', help='create upcoming jobs from the chore schedule')
    g.add_argument('--days', type=int, default=2)
    g.add_argument('--dry-run', action='store_true')
    s = sub.add_parser('schedule', help='read or replace the chore schedule')
    s.add_argument('action', choices=['get', 'set'])
    s.add_argument('file', nargs='?')
    s.add_argument('--dry-run', action='store_true')
    e = sub.add_parser('events', help='copy calendar events into the hub')
    e.add_argument('action', choices=['set'])
    e.add_argument('file')
    e.add_argument('--dry-run', action='store_true')
    d = sub.add_parser('digest', help='replace the weekly digest on the home page')
    d.add_argument('action', choices=['set'])
    d.add_argument('file')
    d.add_argument('--dry-run', action='store_true')
    r = sub.add_parser('rewards', help='read or replace the rewards catalog')
    r.add_argument('action', choices=['get', 'set'])
    r.add_argument('file', nargs='?')
    r.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    hub = Hub()
    hub.sign_in()
    {'generate': cmd_generate, 'schedule': cmd_schedule, 'events': cmd_events, 'digest': cmd_digest, 'rewards': cmd_rewards}[args.cmd](hub, args)


if __name__ == '__main__':
    main()
