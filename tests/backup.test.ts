import { describe, expect, it } from 'vitest';
import {
  MAX_BACKUP_BYTES,
  copyTrip,
  parseBackup,
  parseTripBackup,
  serializeBackup,
  serializeTrip,
} from '../src/backup';
import type { Workspace } from '../src/store';
import { balances } from '../shared/money';
import { project } from '../shared/events';
import { expense, fixture, withEvent } from './fixtures';

function workspace(): Workspace {
  let state = fixture();
  const item = expense(state, {
    attachments: ['data:image/png;base64,aGVsbG8='],
  });
  state = withEvent(state, { kind: 'expense.add', expense: item });
  state = withEvent(state, { kind: 'expense.comment', expenseId: item.id, text: 'Receipt saved' });
  state = withEvent(state, {
    kind: 'expense.edit',
    expenseId: item.id,
    patch: { notes: 'Updated' },
  });
  state = withEvent(state, {
    kind: 'settlement.add',
    settlement: {
      id: 'payment',
      fromUser: 'u1',
      toUser: 'u0',
      amount: 2500,
      currency: 'USD',
      method: 'cash',
      note: 'Paid',
      createdAt: '2026-09-12T12:00:00.000Z',
    },
  });
  return {
    mode: 'local',
    user: { id: 'u0', username: 'alice', displayName: 'Alice', defaultCurrency: 'USD' },
    events: state.events,
    pending: [],
    friends: [],
    notices: [],
    lastSynced: null,
  };
}

describe('individual trip JSON', () => {
  it('round-trips the complete history and makes independent copies without changing money or participants', async () => {
    const original = workspace();
    let source = project(original.events);
    source = withEvent(source, { kind: 'expense.delete', expenseId: source.expenses[0].id });
    source = withEvent(source, { kind: 'expense.restore', expenseId: source.expenses[0].id });
    const parsed = await parseTripBackup(serializeTrip(source, original.user));
    expect(parsed.state).toEqual(source);
    const copied = copyTrip(parsed, original.user.id);
    const another = copyTrip(parsed, original.user.id);
    expect(copied.trip.id).not.toBe(source.trip.id);
    expect(another.trip.id).not.toBe(copied.trip.id);
    expect(copied.trip.members).toEqual(source.trip.members);
    expect(balances(copied)).toEqual(balances(source));
    expect(copied.expenses[0]).toEqual({ ...source.expenses[0], id: copied.expenses[0].id });
    expect(copied.expenses[0].id).not.toBe(source.expenses[0].id);
    expect(copied.comments[0].expenseId).toBe(copied.expenses[0].id);
    expect(copied.comments[0].text).toBe('Receipt saved');
    expect(copied.settlements[0].id).not.toBe(source.settlements[0].id);
    expect(copied.events.map((e) => e.kind)).toEqual(source.events.map((e) => e.kind));
    expect(copied.events.every((e) => e.tripId === copied.trip.id)).toBe(true);
    await expect(parseTripBackup(serializeTrip(copied, original.user))).resolves.toMatchObject({
      state: copied,
    });
    expect(parsed.state).toEqual(source);
  });

  it('preserves tie-sensitive split and FX rounding, even when event timestamps tie', async () => {
    const original = workspace();
    let source = fixture(3);
    source = withEvent(source, {
      kind: 'expense.add',
      expense: expense(source, {
        amount: 100,
        currency: 'EUR',
        fxRate: '1.005',
        payers: [{ userId: 'u0', amountPaid: 100 }],
        splits: [
          { userId: 'u0', owedAmount: 34 },
          { userId: 'u1', owedAmount: 33 },
          { userId: 'u2', owedAmount: 33 },
        ],
      }),
    });
    source.events.forEach((e, i) => {
      e.id = `event-${i}`;
      e.updatedAt = source.events[0].updatedAt;
    });
    const parsed = await parseTripBackup(serializeTrip(source, original.user));
    const copied = copyTrip(parsed, 'u0');
    expect(balances(copied)).toEqual(balances(parsed.state));
    expect(copied.expenses[0].splitMethod).toBe('even');
    await expect(parseTripBackup(serializeTrip(copied, original.user))).resolves.toBeDefined();
  });

  it('preserves imported identities in full backups without changing the workspace profile', async () => {
    const original = workspace();
    const state = project(original.events);
    const copy = copyTrip(await parseTripBackup(serializeTrip(state, original.user)), 'u0');
    const saved = {
      ...original,
      user: { ...original.user, id: 'different-local-user', displayName: 'Someone else' },
      events: copy.events,
      localTripMembers: { [copy.trip.id]: 'u0' },
    };
    const restored = await parseBackup(serializeBackup(saved));
    expect(restored.workspace).toEqual(saved);
    expect(restored.trips).toBe(1);
    await expect(
      parseBackup(
        serializeBackup({
          ...saved,
          localTripMembers: { [copy.trip.id]: 'outsider' },
        }),
      ),
    ).rejects.toThrow('invalid local trip participant');
    await expect(
      parseBackup(
        serializeBackup({
          ...saved,
          mode: 'cloud',
        }),
      ),
    ).rejects.toThrow('Shared workspaces');
  });

  it('rejects wrong formats, mixed trips, duplicates, invalid finances and invalid identities', async () => {
    const original = workspace();
    const state = project(original.events);
    const text = serializeTrip(state, original.user);
    const json = JSON.parse(text);
    await expect(parseTripBackup(serializeBackup(original))).rejects.toThrow('single-trip');
    await expect(parseTripBackup(JSON.stringify({ ...json, version: 2 }))).rejects.toThrow(
      'version',
    );
    await expect(parseTripBackup(JSON.stringify({ ...json, tripId: 'other' }))).rejects.toThrow(
      'exactly one',
    );
    await expect(parseTripBackup(JSON.stringify({ ...json, events: [] }))).rejects.toThrow(
      'Invalid trip',
    );
    await expect(
      parseTripBackup(
        JSON.stringify({
          ...json,
          events: [...json.events, json.events[0]],
        }),
      ),
    ).rejects.toThrow('duplicate event');
    const invalid = structuredClone(state);
    const added = invalid.events.find((e) => e.kind === 'expense.add')!;
    if (added.kind === 'expense.add') added.expense.payers[0].amountPaid = 1;
    await expect(parseTripBackup(serializeTrip(invalid, original.user))).rejects.toThrow(
      'Payer amounts',
    );
    const parsed = await parseTripBackup(text);
    expect(() => copyTrip(parsed, 'outsider')).toThrow('non-placeholder');
    expect(() => copyTrip(parsed, 'u1')).toThrow('non-placeholder');
  });

  it('preserves closed trips and refuses to resurrect deleted trips', async () => {
    const original = workspace();
    let state = fixture();
    state = withEvent(state, { kind: 'trip.status', status: 'settling' });
    state = withEvent(state, { kind: 'trip.status', status: 'closed' });
    const parsed = await parseTripBackup(serializeTrip(state, original.user));
    expect(copyTrip(parsed, 'u0').trip.status).toBe('closed');
    state = withEvent(state, { kind: 'trip.delete' });
    await expect(parseTripBackup(serializeTrip(state, original.user))).rejects.toThrow(
      'Deleted trips',
    );
  });
});

describe('JSON backups', () => {
  it('round-trips receipts, comments, payments, profile, history and exact balances', async () => {
    const original = workspace();
    const text = serializeBackup(original);
    expect(JSON.parse(text)).toMatchObject({ format: 'ensemble-backup', version: 1 });
    const restored = await parseBackup(text);
    expect(restored.workspace).toEqual(original);
    expect(restored.trips).toBe(1);
    expect(restored.expenses).toBe(1);
    expect(balances(project(restored.workspace.events))).toEqual(
      balances(project(original.events)),
    );
  });

  it('accepts older raw workspace backups', async () => {
    const original = workspace();
    expect((await parseBackup(JSON.stringify(original))).workspace).toEqual(original);
  });

  it('keeps shared data and pending events local without importing sync/account state', async () => {
    const original = workspace();
    original.mode = 'cloud';
    original.pending = [original.events.at(-1)!.id];
    original.lastSynced = '2026-09-12T12:00:00.000Z';
    original.friends = [{ id: 'friend', user: original.user, status: 'accepted', incoming: true }];
    const restored = await parseBackup(serializeBackup(original));
    expect(restored.sourceMode).toBe('cloud');
    expect(restored.pendingChanges).toBe(1);
    expect(restored.workspace).toEqual({
      ...original,
      mode: 'local',
      pending: [],
      friends: [],
      notices: [],
      lastSynced: null,
    });
  });

  it('preserves deleted expenses and trips without resurrecting them', async () => {
    const original = workspace();
    let state = project(original.events);
    state = withEvent(state, { kind: 'expense.delete', expenseId: state.expenses[0].id });
    state = withEvent(state, { kind: 'trip.delete' });
    original.events = state.events;
    const restored = await parseBackup(serializeBackup(original));
    expect(restored.trips).toBe(0);
    expect(restored.deletedTrips).toBe(1);
    expect(restored.workspace.events).toEqual(original.events);
  });

  it('accepts an empty workspace', async () => {
    const original = { ...workspace(), events: [] };
    expect((await parseBackup(serializeBackup(original))).trips).toBe(0);
  });

  it('restores invited members, placeholder merges and closed trips', async () => {
    const original = workspace();
    let state = fixture(2);
    state = withEvent(
      state,
      {
        kind: 'member.add',
        member: { id: 'real-bob', name: 'Bob', isGhost: false, role: 'member' },
      },
      'real-bob',
    );
    state = withEvent(state, {
      kind: 'member.claim',
      ghostId: 'u1',
      user: { id: 'real-bob', username: 'bob', displayName: 'Bob', defaultCurrency: 'USD' },
    });
    state = withEvent(state, { kind: 'trip.status', status: 'settling' });
    state = withEvent(state, { kind: 'trip.status', status: 'closed' });
    original.events = state.events;
    const restored = await parseBackup(serializeBackup(original));
    expect(project(restored.workspace.events)).toEqual(state);
  });

  it('rejects changes from actors outside the trip', async () => {
    const original = workspace();
    original.events.at(-1)!.actor = 'outsider';
    await expect(parseBackup(serializeBackup(original))).rejects.toThrow('Only current members');
  });

  it('enforces the event count limit', async () => {
    const original = workspace();
    original.events = Array.from({ length: 10_001 }, () => original.events[0]);
    await expect(parseBackup(serializeBackup(original))).rejects.toThrow('10000');
  });

  it('rejects malformed JSON, wrong formats and unsupported versions', async () => {
    await expect(parseBackup('not json')).rejects.toThrow('not valid JSON');
    await expect(parseBackup('{}')).rejects.toThrow('Invalid or unsupported');
    const saved = JSON.parse(serializeBackup(workspace()));
    await expect(parseBackup(JSON.stringify({ ...saved, version: 2 }))).rejects.toThrow('version');
    await expect(parseBackup(JSON.stringify({ ...saved, format: 'another-app' }))).rejects.toThrow(
      'format',
    );
  });

  it('rejects excessive file size before parsing', async () => {
    await expect(parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).rejects.toThrow('25 MB');
  });

  it('rejects malformed events and duplicate IDs', async () => {
    const original = workspace();
    await expect(
      parseBackup(JSON.stringify({ ...original, events: [{ kind: 'expense.add' }] })),
    ).rejects.toThrow('Invalid or unsupported');
    original.events.push(original.events[0]);
    await expect(parseBackup(serializeBackup(original))).rejects.toThrow('duplicate event');
  });

  it('rejects missing creation events and invalid financial totals', async () => {
    const original = workspace();
    await expect(
      parseBackup(serializeBackup({ ...original, events: original.events.slice(1) })),
    ).rejects.toThrow('Trip not found');
    const added = original.events.find((e) => e.kind === 'expense.add')!;
    if (added.kind === 'expense.add') added.expense.payers[0].amountPaid = 1;
    await expect(parseBackup(serializeBackup(original))).rejects.toThrow('Payer amounts');
  });

  it('rejects edits that overwrite immutable history and unsafe receipt URLs', async () => {
    const original = workspace();
    const text = serializeBackup(original).replace('"notes": "Updated"', '"createdBy": "attacker"');
    await expect(parseBackup(text)).rejects.toThrow('Invalid or unsupported');
    await expect(
      parseBackup(
        serializeBackup(original).replace(
          'data:image/png;base64,aGVsbG8=',
          'https://external.example/receipt',
        ),
      ),
    ).rejects.toThrow('Receipts');
  });

  it('rejects missing pending changes and terminal-trip conflicts without silently dropping data', async () => {
    const original = workspace();
    original.mode = 'cloud';
    original.pending = ['missing'];
    await expect(parseBackup(serializeBackup(original))).rejects.toThrow('missing or duplicate');
    original.pending = [];
    let state = withEvent(project(original.events), { kind: 'trip.delete' });
    state = withEvent(state, {
      kind: 'expense.comment',
      expenseId: state.expenses[0].id,
      text: 'Offline conflict',
    });
    original.events = state.events;
    original.pending = [state.events.at(-1)!.id];
    await expect(parseBackup(serializeBackup(original))).rejects.toThrow('deleted');
  });
});
