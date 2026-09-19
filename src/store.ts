import { useSyncExternalStore } from 'react';
import { makeEvent, project, validateEvent } from '../shared/events';
import { splitAmount } from '../shared/money';
import type { EventData, Friend, Notice, Trip, TripEvent, TripState, User } from '../shared/types';
import { copyTrip, type ParsedTripBackup } from './backup';

export interface Workspace {
  mode: 'local' | 'cloud';
  user: User;
  events: TripEvent[];
  pending: string[];
  friends: Friend[];
  notices: Notice[];
  lastSynced: string | null;
  localTripMembers?: Record<string, string>;
}
interface Snapshot {
  workspace: Workspace | null;
  loading: boolean;
  syncing: boolean;
  online: boolean;
  error: string | null;
}
let snapshot: Snapshot = {
  workspace: null,
  loading: true,
  syncing: false,
  online: navigator.onLine,
  error: null,
};
const listeners = new Set<() => void>();
function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}
export function useWorkspace() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
export function clearError() {
  publish({ error: null });
}
export function showError(error: unknown) {
  publish({ error: error instanceof Error ? error.message : String(error) });
}
let database: Promise<IDBDatabase> | null = null;
function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('ensemble', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('Browser storage is unavailable. Allow site storage to use Ensemble.'));
  });
  return database;
}
async function read<T>(key: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('workspace').objectStore('workspace').get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () =>
      reject(new Error('Could not read your saved trips. Try reloading this page.'));
  });
}
async function persist(entries: [string, unknown][], remove?: string) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction('workspace', 'readwrite');
    for (const [key, value] of entries) tx.objectStore('workspace').put(value, key);
    if (remove) tx.objectStore('workspace').delete(remove);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new Error(
          'Your change was not saved: browser storage is full or unavailable. Export your trip and free space before trying again.',
        ),
      );
  });
}
const keyFor = (w: Workspace) => (w.mode === 'local' ? 'local' : `cloud:${w.user.id}`);
let writes = Promise.resolve();
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('ensemble-workspace') : null;
channel?.addEventListener('message', () => {
  void (async () => {
    const selected = await read<string>('current');
    if (!snapshot.workspace || !selected) return;
    if (selected !== keyFor(snapshot.workspace)) {
      location.reload();
      return;
    }
    const workspace = await read<Workspace>(selected);
    if (workspace) publish({ workspace });
  })().catch(showError);
});
function update(fn: (current: Workspace) => Workspace): Promise<void> {
  const expectedKey = snapshot.workspace ? keyFor(snapshot.workspace) : null;
  const work = writes.then(async () => {
    if (!expectedKey) throw new Error('Workspace is not ready.');
    const database = await db();
    const next = await new Promise<Workspace>((resolve, reject) => {
      const tx = database.transaction('workspace', 'readwrite');
      const store = tx.objectStore('workspace');
      let result: Workspace;
      const selected = store.get('current');
      selected.onsuccess = () => {
        if (selected.result !== expectedKey) {
          tx.abort();
          reject(new Error('Your account changed in another tab. Reload before making changes.'));
          return;
        }
        const request = store.get(expectedKey);
        request.onsuccess = () => {
          try {
            if (!request.result)
              throw new Error('Workspace is no longer available. Reload this page.');
            result = fn(request.result as Workspace);
            store.put(result, expectedKey);
          } catch (error) {
            tx.abort();
            reject(error);
          }
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(new Error('This change was not saved. Browser storage may be full or unavailable.'));
    });
    publish({ workspace: next });
    channel?.postMessage({ key: expectedKey });
  });
  writes = work.catch(showError);
  return work;
}
export function tripStates(workspace: Workspace): TripState[] {
  const groups = new Map<string, TripEvent[]>();
  for (const event of workspace.events) {
    const group = groups.get(event.tripId) ?? [];
    group.push(event);
    groups.set(event.tripId, group);
  }
  return [...groups.values()]
    .filter((events) => !events.some((e) => e.kind === 'trip.delete'))
    .map(project)
    .filter((s) =>
      s.trip.members.some((m) => m.id === tripMemberId(workspace, s.trip.id) && !m.left),
    )
    .sort((a, b) => b.trip.createdAt.localeCompare(a.trip.createdAt));
}
export function tripMemberId(workspace: Workspace, tripId: string): string {
  return (
    (workspace.mode === 'local' ? workspace.localTripMembers?.[tripId] : undefined) ??
    workspace.user.id
  );
}

export async function importLocalTrip(backup: ParsedTripBackup, memberId: string) {
  const state = copyTrip(backup, memberId);
  await update((current) => {
    if (current.mode !== 'local')
      throw new Error('Sign out before importing a trip into your local workspace.');
    if (current.events.some((e) => e.tripId === state.trip.id))
      throw new Error('This trip copy already exists. Open import again to make another copy.');
    return {
      ...current,
      events: [...current.events, ...state.events],
      localTripMembers: { ...current.localTripMembers, [state.trip.id]: memberId },
    };
  });
  return state.trip.id;
}
function demoWorkspace(): Workspace {
  const user: User = {
    id: 'local-you',
    username: 'you',
    displayName: 'Alex',
    defaultCurrency: 'USD',
  };
  const trip: Trip = {
    id: 'sample-lisbon',
    name: 'Lisbon, with love',
    description: 'Pastel de nata, ocean air, and a few very good friends.',
    baseCurrency: 'EUR',
    startDate: '2026-09-12',
    endDate: '2026-09-16',
    status: 'active',
    createdBy: user.id,
    createdAt: '2026-09-12T09:00:00.000Z',
    members: [{ id: user.id, name: 'Alex', role: 'organizer', isGhost: false }],
  };
  const events: TripEvent[] = [];
  function add(data: EventData) {
    const event = makeEvent(trip.id, user.id, data);
    event.updatedAt = new Date(Date.parse(trip.createdAt) + events.length * 1000).toISOString();
    events.push(event);
  }
  add({ kind: 'trip.create', trip });
  for (const [id, name] of [
    ['sam', 'Sam'],
    ['jamie', 'Jamie'],
    ['taylor', 'Taylor'],
  ])
    add({ kind: 'member.add', member: { id, name, role: 'member', isGhost: true } });
  const participants = [user.id, 'sam', 'jamie', 'taylor'].map((userId) => ({
    userId,
    value: '1',
  }));
  for (const [description, amount, payer, category, date] of [
    ['Our little home in Alfama', 42000, user.id, 'lodging', '2026-09-12'],
    ['Dinner by the waterfront', 8640, 'sam', 'food', '2026-09-13'],
    ['Tram rides & airport taxi', 4800, 'jamie', 'transport', '2026-09-13'],
    ['A day out in Sintra', 6400, user.id, 'activity', '2026-09-14'],
    ['One more round of pastries', 2480, 'taylor', 'food', '2026-09-14'],
  ] as const) {
    add({
      kind: 'expense.add',
      expense: {
        id: crypto.randomUUID(),
        description,
        amount,
        currency: 'EUR',
        fxRate: '1',
        date,
        category,
        payers: [{ userId: payer, amountPaid: amount }],
        splitMethod: 'even',
        splits: splitAmount(amount, 'even', participants, 'EUR'),
        notes: '',
        attachments: [],
        createdBy: user.id,
        createdAt: date + 'T12:00:00.000Z',
        updatedAt: date + 'T12:00:00.000Z',
      },
    });
  }
  return { mode: 'local', user, events, pending: [], friends: [], notices: [], lastSynced: null };
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    ...(data !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
      : {}),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw new Error(
      'Cloud sync is unavailable here. Local mode works without a server; accounts require the Cloudflare API and D1.',
    );
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, result.error ?? 'The request failed.');
  return result;
}
let started = false;
export async function initialize() {
  if (started) return;
  started = true;
  try {
    const selected = (await read<string>('current')) ?? 'local';
    const saved = await read<Workspace>(selected);
    const workspace = saved ?? demoWorkspace();
    await persist([
      [keyFor(workspace), workspace],
      ['current', keyFor(workspace)],
    ]);
    publish({ workspace, loading: false });
    if (workspace.mode === 'cloud') void sync().catch(showError);
  } catch (error) {
    publish({ loading: false });
    showError(error);
  }
}
export async function dispatch(tripId: string, data: EventData) {
  await update((w) => {
    const current = w.events.filter((e) => e.tripId === tripId);
    const event = makeEvent(tripId, tripMemberId(w, tripId), data);
    const last = current.reduce((max, e) => Math.max(max, Date.parse(e.updatedAt)), 0);
    event.updatedAt = new Date(Math.max(Date.now(), last + 1)).toISOString();
    validateEvent(event, current.length ? project(current) : null);
    return {
      ...w,
      events: [...w.events, event],
      pending: w.mode === 'cloud' ? [...w.pending, event.id] : w.pending,
    };
  });
  if (snapshot.workspace?.mode === 'cloud') void sync().catch(showError);
}
export function rebasePending(events: TripEvent[], pending: string[]): TripEvent[] {
  const pendingIds = new Set(pending);
  const confirmed = events.filter((e) => !pendingIds.has(e.id));
  let clock = confirmed.reduce((max, e) => Math.max(max, Date.parse(e.updatedAt)), Date.now());
  return [
    ...confirmed,
    ...pending.map((id) => {
      const event = events.find((e) => e.id === id);
      if (!event) throw new Error('A queued change is missing. Export a backup before reloading.');
      return { ...event, updatedAt: new Date(++clock).toISOString() };
    }),
  ];
}
async function refreshWorkspace(account: string) {
  const result = await api<{
    user: User;
    events: TripEvent[];
    friends: Friend[];
    notices: Notice[];
  }>('bootstrap');
  await update((w) => {
    if (w.mode !== 'cloud' || w.user.id !== account || result.user.id !== account)
      throw new Error(
        'Your session changed. Sign back into the same account to keep your offline changes.',
      );
    const confirmed = new Set(result.events.map((e) => e.id));
    const pending = w.events.filter((e) => w.pending.includes(e.id) && !confirmed.has(e.id));
    const ids = pending.map((e) => e.id);
    return {
      ...w,
      ...result,
      events: rebasePending([...result.events, ...pending], ids),
      pending: ids,
      lastSynced: new Date().toISOString(),
    };
  });
}
let syncWork: Promise<void> | null = null;
export function sync(): Promise<void> {
  if (syncWork) return syncWork;
  if (!navigator.onLine || snapshot.workspace?.mode !== 'cloud') return Promise.resolve();
  const account = snapshot.workspace.user.id;
  syncWork = (async () => {
    publish({ syncing: true, error: null });
    try {
      while (snapshot.workspace?.pending.length) {
        const id = snapshot.workspace.pending[0];
        const event = snapshot.workspace.events.find((e) => e.id === id)!;
        let result: { event: TripEvent };
        try {
          result = await api<{ event: TripEvent }>('events', 'POST', { event });
        } catch (error) {
          if (error instanceof ApiError && error.status === 410) {
            await refreshWorkspace(account);
            throw new Error(
              `${error.message} Your unsynced changes were kept for export or discard in Your workspace.`,
            );
          }
          throw error;
        }
        await update((w) => {
          if (w.mode !== 'cloud' || w.user.id !== account)
            throw new Error('Your account changed during sync. Reload this page.');
          const pending = w.pending.filter((pending) => pending !== id);
          return {
            ...w,
            events: rebasePending(
              w.events.map((e) => (e.id === id ? result.event : e)),
              pending,
            ),
            pending,
          };
        });
      }
      await refreshWorkspace(account);
    } finally {
      publish({ syncing: false });
      syncWork = null;
    }
  })();
  return syncWork;
}
export async function discardPending() {
  await update((w) => ({
    ...w,
    events: w.events.filter((e) => !w.pending.includes(e.id)),
    pending: [],
  }));
  await sync();
}
export async function authenticate(
  kind: 'login' | 'signup',
  input: { username: string; password: string; displayName: string; currency: string },
) {
  if (syncWork) throw new Error('Wait for the current sync to finish before signing in.');
  if (
    snapshot.workspace?.mode === 'cloud' &&
    snapshot.workspace.pending.length &&
    (kind !== 'login' || input.username.toLowerCase() !== snapshot.workspace.user.username)
  ) {
    throw new Error(
      'Sign back into the same account to sync your pending changes before switching accounts.',
    );
  }
  await writes;
  const result = await api<{ user: User }>(`auth/${kind}`, 'POST', input);
  const workspace: Workspace = {
    mode: 'cloud',
    user: result.user,
    events: [],
    pending: [],
    friends: [],
    notices: [],
    lastSynced: null,
  };
  const cached = await read<Workspace>(keyFor(workspace));
  const next = cached ?? workspace;
  await persist([
    [keyFor(next), next],
    ['current', keyFor(next)],
  ]);
  publish({ workspace: next, error: null });
  channel?.postMessage({ key: keyFor(next) });
  await sync();
}
export async function logout() {
  if (syncWork) throw new Error('Wait for the current sync to finish before signing out.');
  await writes;
  if (snapshot.workspace?.pending.length)
    throw new Error(
      'Sync your pending changes before signing out, or export them and discard the queue.',
    );
  await api('auth/logout', 'POST', {});
  const previous = snapshot.workspace!;
  const workspace = (await read<Workspace>('local')) ?? demoWorkspace();
  await persist(
    [
      ['current', 'local'],
      ['local', workspace],
    ],
    keyFor(previous),
  );
  publish({ workspace, error: null });
  channel?.postMessage({ key: 'local' });
}
export async function updateLocalProfile(displayName: string) {
  await update((w) => ({ ...w, user: { ...w.user, displayName } }));
}
export async function restoreLocalBackup(workspace: Workspace, expected: Workspace) {
  await update((current) => {
    if (current.mode !== 'local' || workspace.mode !== 'local' || workspace.pending.length)
      throw new Error('Sign out before importing. Backups can only replace a local workspace.');
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error(
        'Your local workspace changed while reviewing this backup. Close and reopen import before trying again.',
      );
    return workspace;
  });
}
export async function cloudAction(path: string, method: string, data: unknown) {
  if (snapshot.workspace?.pending.length) await sync();
  const result = await api<Record<string, string>>(path, method, data);
  await sync();
  return result;
}
window.addEventListener('online', () => {
  publish({ online: true });
  void sync().catch(showError);
});
window.addEventListener('offline', () => publish({ online: false }));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void sync().catch(showError);
});
setInterval(() => {
  if (!document.hidden) void sync().catch(showError);
}, 30_000);
