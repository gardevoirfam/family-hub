// Live data from Firebase Auth + Firestore. See docs/data-model.md for the schema.
import { firebaseConfig, FIREBASE_VERSION } from './config.js';
import { toEmail } from './usernames.js';
import { cleanDigest } from './digest.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const [{ initializeApp }, authMod, fs] = await Promise.all([
  import(`${CDN}/firebase-app.js`),
  import(`${CDN}/firebase-auth.js`),
  import(`${CDN}/firebase-firestore.js`)
]);

const app = initializeApp(firebaseConfig);
const auth = authMod.getAuth(app);
// Keeps a local copy so the iPad still shows the last data if Wi-Fi drops.
const db = fs.initializeFirestore(app, {
  localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
});

// "estimate" fills a just-written serverTimestamp with the local time, so a
// fresh check-off reads as done today before the server confirms it.
const toTask = d => {
  const x = d.data({ serverTimestamps: 'estimate' });
  return {
    id: d.id,
    personId: x.personId || '',
    // Everyone the task belongs to. Shared tasks list several people in personIds.
    personIds: Array.isArray(x.personIds) && x.personIds.length ? x.personIds : (x.personId ? [x.personId] : []),
    title: x.title || '',
    start: toDate(x.start),
    due: toDate(x.due),
    points: Number(x.points) || 0,
    done: !!x.done,
    doneAt: toDate(x.doneAt),
    // Repeating tasks come back cooldownDays after they're done.
    cooldownDays: Number(x.cooldownDays) > 0 ? Number(x.cooldownDays) : 0,
    needsApproval: x.needsApproval === true,
    pendingAt: toDate(x.pendingAt)
  };
};

const toDate = v => (v && typeof v.toDate === 'function') ? v.toDate() : (v ? new Date(v) : null);


const AUTH_ERRORS = {
  'auth/invalid-credential': "That username and password didn't match.",
  'auth/invalid-login-credentials': "That username and password didn't match.",
  'auth/wrong-password': "That username and password didn't match.",
  'auth/user-not-found': "That username and password didn't match.",
  'auth/invalid-email': "That username doesn't look right.",
  'auth/missing-password': 'Enter the password.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/network-request-failed': "Can't reach the internet. Check the Wi-Fi and try again.",
  'auth/user-disabled': 'This login has been turned off.'
};

function habitFrom(d) {
  const x = d.data();
  return {
    id: d.id,
    personId: x.personId || '',
    name: x.name || '',
    order: typeof x.order === 'number' ? x.order : 999,
    points: Number.isInteger(x.points) ? x.points : undefined,
    perWeek: Number.isInteger(x.perWeek) ? x.perWeek : undefined,
    bonus: Number.isInteger(x.bonus) ? x.bonus : undefined,
    weekdays: Array.isArray(x.weekdays) ? x.weekdays : undefined,
    needsApproval: x.needsApproval === true,
    days: (x.days && typeof x.days === 'object') ? x.days : {}
  };
}

export const source = {
  kind: 'firebase',

  onAuth(cb) {
    return authMod.onAuthStateChanged(auth, user => cb(user ? { uid: user.uid, email: user.email } : null));
  },

  async signIn(username, password) {
    try {
      await authMod.signInWithEmailAndPassword(auth, toEmail(username), password);
    } catch (err) {
      throw new Error(AUTH_ERRORS[err.code] || "Couldn't sign in. Try again.");
    }
  },

  signOut() {
    return authMod.signOut(auth);
  },

  watchPeople(cb, onError) {
    return fs.onSnapshot(fs.collection(db, 'people'), snap => {
      cb(snap.docs.map(d => {
        const x = d.data();
        return {
          id: d.id,
          name: x.name || d.id,
          order: typeof x.order === 'number' ? x.order : 999,
          color: x.color, soft: x.soft,
          points: Number(x.points) || 0,
          streak: Number(x.streak) || 0
        };
      }));
    }, onError);
  },

  // Events from the start of today onward, soonest first.
  watchEvents(from, cb, onError) {
    const q = fs.query(
      fs.collection(db, 'events'),
      fs.where('start', '>=', fs.Timestamp.fromDate(from)),
      fs.orderBy('start'),
      fs.limit(50)
    );
    return fs.onSnapshot(q, snap => {
      cb(snap.docs.map(d => {
        const x = d.data();
        return {
          id: d.id,
          title: x.title || '',
          place: x.place || '',
          notes: typeof x.notes === 'string' ? x.notes : '',
          start: toDate(x.start),
          allDay: !!x.allDay,
          who: Array.isArray(x.who) ? x.who : []
        };
      }));
    }, onError);
  },

  // Everything the home page needs for "today": open tasks, tasks due today,
  // and tasks finished today. Three simple queries avoid composite indexes.
  watchTasks(dayStart, dayEnd, cb, onError) {
    const col = fs.collection(db, 'tasks');
    const ts = fs.Timestamp.fromDate;
    const queries = {
      open: fs.query(col, fs.where('done', '==', false)),
      dueToday: fs.query(col, fs.where('due', '>=', ts(dayStart)), fs.where('due', '<', ts(dayEnd))),
      doneToday: fs.query(col, fs.where('doneAt', '>=', ts(dayStart))),
      // Repeating tasks stay done between rounds, so they need their own query.
      repeating: fs.query(col, fs.where('cooldownDays', '>', 0))
    };
    const parts = {};
    const emit = () => {
      if (Object.keys(parts).length < 4) return;
      const byId = new Map();
      Object.values(parts).forEach(list => list.forEach(t => byId.set(t.id, t)));
      cb([...byId.values()]);
    };
    const unsubs = Object.entries(queries).map(([key, q]) => fs.onSnapshot(q, snap => {
      parts[key] = snap.docs.map(toTask);
      emit();
    }, onError));
    return () => unsubs.forEach(u => u());
  },

  // All of one person's tasks, their own and shared ones. The person page
  // decides what to show.
  watchPersonTasks(personId, cb, onError) {
    const col = fs.collection(db, 'tasks');
    const queries = {
      own: fs.query(col, fs.where('personId', '==', personId)),
      shared: fs.query(col, fs.where('personIds', 'array-contains', personId))
    };
    const parts = {};
    const unsubs = Object.entries(queries).map(([key, q]) => fs.onSnapshot(q, snap => {
      parts[key] = snap.docs.map(toTask);
      if (Object.keys(parts).length < 2) return;
      const byId = new Map();
      [...parts.own, ...parts.shared].forEach(t => byId.set(t.id, t));
      cb([...byId.values()]);
    }, onError));
    return () => unsubs.forEach(u => u());
  },

  watchHabits(personId, cb, onError) {
    const q = fs.query(fs.collection(db, 'habits'), fs.where('personId', '==', personId));
    return fs.onSnapshot(q, snap => cb(snap.docs.map(habitFrom)), onError);
  },

  // Tasks ticked and waiting for a grown-up's OK, for the Parents panel.
  watchPendingTasks(cb, onError) {
    const q = fs.query(fs.collection(db, 'tasks'), fs.where('pendingAt', '>', fs.Timestamp.fromMillis(0)));
    return fs.onSnapshot(q, snap => cb(snap.docs.map(toTask)), onError);
  },

  // Habits whose ticks wait for a grown-up's OK, for the Parents panel.
  watchApprovalHabits(cb, onError) {
    const q = fs.query(fs.collection(db, 'habits'), fs.where('needsApproval', '==', true));
    return fs.onSnapshot(q, snap => cb(snap.docs.map(habitFrom)), onError);
  },

  watchRewards(cb, onError) {
    return fs.onSnapshot(fs.collection(db, 'rewards'), snap => {
      cb(snap.docs.map(d => {
        const x = d.data();
        return {
          id: d.id,
          title: x.title || '',
          detail: x.detail || '',
          cost: Number(x.cost) || 0,
          type: x.type || 'fixed',
          unit: x.unit || '',
          unitMinutes: Number(x.unitMinutes) || 0,
          maxQty: Number(x.maxQty) || 0,
          order: Number.isFinite(x.order) ? x.order : 999,
          active: x.active !== false
        };
      }));
    }, onError);
  },

  // Recent claims plus every claim still waiting for a parent.
  watchClaims(cb, onError) {
    const col = fs.collection(db, 'claims');
    const queries = {
      recent: fs.query(col, fs.orderBy('createdAt', 'desc'), fs.limit(10)),
      pending: fs.query(col, fs.where('status', '==', 'pending'))
    };
    const parts = {};
    const unsubs = Object.entries(queries).map(([key, q]) => fs.onSnapshot(q, snap => {
      parts[key] = snap.docs.map(d => {
        const x = d.data({ serverTimestamps: 'estimate' });
        return {
          id: d.id,
          personId: x.personId || '',
          rewardId: x.rewardId || '',
          title: x.title || '',
          cost: Number(x.cost) || 0,
          type: x.type || 'fixed',
          quantity: Number(x.quantity) || 1,
          each: Number(x.each) || 0,
          unit: x.unit || '',
          unitMinutes: Number(x.unitMinutes) || 0,
          status: x.status || 'pending',
          createdAt: toDate(x.createdAt)
        };
      });
      if (Object.keys(parts).length < 2) return;
      const byId = new Map();
      [...parts.recent, ...parts.pending].forEach(c => byId.set(c.id, c));
      cb([...byId.values()]);
    }, onError));
    return () => unsubs.forEach(u => u());
  },

  // The parent PIN (stored as a salted hash), set by the Claude task.
  watchParentSettings(cb, onError) {
    return fs.onSnapshot(fs.doc(db, 'settings', 'parent'), snap => {
      const x = snap.exists() ? snap.data() : {};
      cb({ pinHash: x.pinHash || '', pinSalt: x.pinSalt || '' });
    }, onError);
  },

  // The weekly summary for the bottom of the home page, written by the Claude
  // digest routine.
  watchDigest(cb, onError) {
    return fs.onSnapshot(fs.doc(db, 'settings', 'digest'), snap => {
      cb(cleanDigest(snap.exists() ? snap.data() : null, toDate));
    }, onError);
  },

  // Everyone's pointsLog entries since `from` (filtered by person on the page,
  // so no composite index is needed), plus when the hub's first entry was made.
  watchPointsLog(from, cb, onError) {
    let first;
    let entries;
    const send = () => { if (first !== undefined && entries) cb({ first, entries }); };
    fs.getDocs(fs.query(fs.collection(db, 'pointsLog'), fs.orderBy('at'), fs.limit(1)))
      .then(snap => { first = snap.empty ? null : toDate(snap.docs[0].data().at); send(); },
        () => { first = null; send(); });
    return fs.onSnapshot(
      fs.query(fs.collection(db, 'pointsLog'), fs.where('at', '>=', fs.Timestamp.fromDate(from))),
      snap => {
        entries = snap.docs.map(d => {
          const x = d.data({ serverTimestamps: 'estimate' });
          return { personId: x.personId || '', delta: Number(x.delta) || 0, reason: x.reason || '', at: toDate(x.at) };
        });
        if (first === null && entries.length) first = entries.reduce((a, e) => (e.at && e.at < a ? e.at : a), entries[0].at);
        send();
      }, onError);
  },

  // Applies one check-off as a single batch: the task or habit, the person's
  // points and streak, and the matching pointsLog entries. A batch (rather than
  // a transaction) still works offline and syncs when Wi-Fi returns.
  async commit({ task, habit, person, people, logs, claimCreate, claimUpdate }) {
    const batch = fs.writeBatch(db);
    if (claimCreate) {
      const fields = {
        personId: claimCreate.personId, rewardId: claimCreate.rewardId,
        title: claimCreate.title, cost: claimCreate.cost,
        status: 'pending', createdAt: fs.serverTimestamp()
      };
      // Flexible and per-unit claims carry their amount; fixed ones stay as before.
      if (claimCreate.type) {
        Object.assign(fields, { type: claimCreate.type, quantity: claimCreate.quantity, each: claimCreate.each });
        if (claimCreate.unit) fields.unit = claimCreate.unit;
        if (claimCreate.unitMinutes) fields.unitMinutes = claimCreate.unitMinutes;
      }
      batch.set(fs.doc(fs.collection(db, 'claims')), fields);
    }
    if (claimUpdate) {
      const fields = { status: claimUpdate.status, decidedAt: fs.serverTimestamp() };
      for (const k of ['cost', 'quantity', 'each']) if (k in claimUpdate) fields[k] = claimUpdate[k];
      batch.update(fs.doc(db, 'claims', claimUpdate.id), fields);
    }
    if (task) {
      const fields = {};
      if ('done' in task) {
        fields.done = task.done;
        fields.doneAt = !task.done ? null : task.doneAt ? fs.Timestamp.fromDate(task.doneAt) : fs.serverTimestamp();
      }
      // Only tasks that need approval ever have pendingAt set.
      if (task.pending) fields.pendingAt = fs.serverTimestamp();
      else if (task.clearPending) fields.pendingAt = null;
      batch.update(fs.doc(db, 'tasks', task.id), fields);
    }
    if (habit) {
      batch.update(fs.doc(db, 'habits', habit.id),
        new fs.FieldPath('days', habit.day), habit.done ? (habit.value || true) : fs.deleteField());
    }
    for (const p of [person, ...(people || [])].filter(Boolean)) {
      batch.update(fs.doc(db, 'people', p.id), { points: p.points, streak: p.streak });
    }
    for (const log of logs || []) {
      batch.set(fs.doc(fs.collection(db, 'pointsLog')), {
        personId: log.personId, delta: log.delta, reason: log.reason, at: fs.serverTimestamp()
      });
    }
    await batch.commit();
  }
};
