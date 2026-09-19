import { describe, expect, it } from 'vitest';
import { eventLabel, makeEvent, project, validateEvent, validateExpense } from '../shared/events';
import type { EventData } from '../shared/types';
import { balances } from '../shared/money';
import { expense, fixture, withEvent } from './fixtures';

describe('immutable event projection and validation', () => {
  it('edits trip metadata without changing identity, membership or finances', () => {
    let state = fixture();
    state = withEvent(state, { kind: 'expense.add', expense: expense(state) });
    const before = structuredClone(state);
    const edit = makeEvent(state.trip.id, 'u0', {
      kind: 'trip.edit',
      patch: {
        name: 'Mountain weekend',
        description: 'Friends, hiking, and dinner',
        dates: { startDate: '2026-10-01', endDate: '2026-10-04' },
      },
    });
    expect(() => validateEvent(edit, state)).not.toThrow();
    state = project([...state.events, edit]);
    expect(state.trip).toEqual({
      ...before.trip,
      name: 'Mountain weekend',
      description: 'Friends, hiking, and dinner',
      startDate: '2026-10-01',
      endDate: '2026-10-04',
    });
    expect(state.expenses).toEqual(before.expenses);
    expect(balances(state)).toEqual(balances(before));
    expect(project([...state.events].reverse())).toEqual(state);
    expect(project([...state.events, edit])).toEqual(state);
    expect(eventLabel(edit, (id) => id)).toBe('updated the trip details');
  });

  it('merges separate trip fields while treating the date range as one change', () => {
    let state = fixture();
    state = withEvent(state, {
      kind: 'trip.edit',
      patch: { name: 'New name', dates: { startDate: '2026-10-01', endDate: '2026-10-04' } },
    });
    state = withEvent(state, { kind: 'trip.edit', patch: { description: 'Concurrent note' } });
    state = withEvent(state, {
      kind: 'trip.edit',
      patch: { dates: { startDate: '2026-11-01', endDate: '2026-11-02' } },
    });
    expect(state.trip).toMatchObject({
      name: 'New name',
      description: 'Concurrent note',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
    });
    const clear = makeEvent(state.trip.id, 'u0', {
      kind: 'trip.edit',
      patch: { description: '', dates: { startDate: '', endDate: '' } },
    });
    expect(() => validateEvent(clear, state)).not.toThrow();
    expect(project([...state.events, clear]).trip).toMatchObject({
      description: '',
      startDate: '',
      endDate: '',
    });
  });

  it('restricts trip editing to active organizers of open trips', () => {
    let state = fixture();
    const joined = state.events.find((e) => e.kind === 'member.add')!;
    if (joined.kind === 'member.add') joined.member.isGhost = false;
    state = project(state.events);
    const data: EventData = { kind: 'trip.edit', patch: { name: 'Changed' } };
    expect(() => validateEvent(makeEvent(state.trip.id, 'u1', data), state)).toThrow(
      'Only the organizer',
    );
    expect(() => validateEvent(makeEvent(state.trip.id, 'outsider', data), state)).toThrow(
      'Only current members',
    );
    expect(() => validateEvent(makeEvent(state.trip.id, 'outsider', data), state, true)).toThrow(
      'Only the organizer',
    );
    state = withEvent(state, { kind: 'trip.status', status: 'settling' });
    expect(() => validateEvent(makeEvent(state.trip.id, 'u0', data), state)).not.toThrow();
    state = withEvent(state, { kind: 'trip.status', status: 'closed' });
    expect(() => validateEvent(makeEvent(state.trip.id, 'u0', data), state)).toThrow('Reopen');
    state = withEvent(state, { kind: 'trip.delete' });
    expect(() => validateEvent(makeEvent(state.trip.id, 'u0', data), state)).toThrow('deleted');
  });

  it('rejects invalid trip patches, dates and changes to immutable fields', () => {
    const state = fixture();
    for (const patch of [
      null,
      [],
      {},
      { name: '' },
      { name: ' '.repeat(5) },
      { name: 'x'.repeat(81) },
      { description: 'x'.repeat(1001) },
      { description: 123 },
      { baseCurrency: 'EUR' },
      { status: 'closed' },
      { id: 'another' },
      { createdBy: 'u1' },
      { members: [] },
      { dates: null },
      { dates: { startDate: '2026-01-01' } },
      { dates: { startDate: 'invalid', endDate: '' } },
      { dates: { startDate: '2026-02-30', endDate: '' } },
      { dates: { startDate: '2026-10-04', endDate: '2026-10-01' } },
      { dates: { startDate: '', endDate: '', baseCurrency: 'EUR' } },
    ]) {
      const event = JSON.parse(
        JSON.stringify(
          makeEvent(state.trip.id, 'u0', {
            kind: 'trip.edit',
            patch: { name: 'Valid' },
          }),
        ),
      );
      event.patch = patch;
      expect(() => validateEvent(event, state)).toThrow();
    }
  });

  it.each(['active', 'settling', 'closed'] as const)(
    'allows the organizer to delete a %s trip',
    (status) => {
      let state = fixture();
      if (status === 'active')
        state = withEvent(state, { kind: 'expense.add', expense: expense(state) });
      if (status !== 'active')
        state = withEvent(state, { kind: 'trip.status', status: 'settling' });
      if (status === 'closed') state = withEvent(state, { kind: 'trip.status', status: 'closed' });
      const before = structuredClone(state);
      const deletion = makeEvent(state.trip.id, 'u0', { kind: 'trip.delete' });
      expect(() => validateEvent(deletion, state)).not.toThrow();
      const deleted = project([...state.events, deletion]);
      expect(deleted.trip.deletedAt).toBe(deletion.updatedAt);
      expect(deleted.expenses).toEqual(before.expenses);
      expect(balances(deleted)).toEqual(balances(before));
      expect(eventLabel(deletion, (id) => id)).toBe('deleted the trip');
      expect(project([...deleted.events].reverse())).toEqual(deleted);
      expect(project([...deleted.events, deletion])).toEqual(deleted);
      expect(state).toEqual(before);
    },
  );
  it('rejects member and outsider deletion, including trusted invite operations', () => {
    let state = fixture();
    const joined = state.events.find((e) => e.kind === 'member.add');
    if (joined?.kind === 'member.add') joined.member.isGhost = false;
    state = project(state.events);
    expect(() =>
      validateEvent(makeEvent(state.trip.id, 'u1', { kind: 'trip.delete' }), state),
    ).toThrow('Only the organizer');
    expect(() =>
      validateEvent(makeEvent(state.trip.id, 'outsider', { kind: 'trip.delete' }), state),
    ).toThrow('Only current members');
    expect(() =>
      validateEvent(makeEvent(state.trip.id, 'outsider', { kind: 'trip.delete' }), state, true),
    ).toThrow('Only the organizer');
  });
  it('prevents resurrection, new expenses, payments and joins after deletion', () => {
    let state = fixture();
    const original = expense(state);
    state = withEvent(state, { kind: 'expense.add', expense: original });
    state = withEvent(state, { kind: 'trip.delete' });
    const changes: EventData[] = [
      { kind: 'trip.edit', patch: { description: 'Stale trip description' } },
      { kind: 'trip.delete' },
      { kind: 'trip.status', status: 'active' },
      { kind: 'expense.add', expense: expense(state) },
      { kind: 'expense.edit', expenseId: original.id, patch: { notes: 'Stale edit' } },
      { kind: 'expense.delete', expenseId: original.id },
      { kind: 'expense.restore', expenseId: original.id },
      { kind: 'expense.comment', expenseId: original.id, text: 'Stale comment' },
      {
        kind: 'member.add',
        member: { id: 'new-user', name: 'New friend', role: 'member', isGhost: false },
      },
      {
        kind: 'member.claim',
        ghostId: 'u1',
        user: { id: 'u0', username: 'alice', displayName: 'Alice', defaultCurrency: 'USD' },
      },
      {
        kind: 'settlement.add',
        settlement: {
          id: 'payment',
          fromUser: 'u1',
          toUser: 'u0',
          amount: 2500,
          currency: 'USD',
          method: 'cash',
          note: '',
          createdAt: new Date().toISOString(),
        },
      },
    ];
    for (const change of changes) {
      expect(() => validateEvent(makeEvent(state.trip.id, 'u0', change), state, true)).toThrow(
        'This trip has been deleted',
      );
    }
    const stale = withEvent(state, { kind: 'trip.status', status: 'active' });
    expect(stale.trip.deletedAt).toBe(state.trip.deletedAt);
    expect(project([...stale.events].reverse()).trip.deletedAt).toBe(state.trip.deletedAt);
  });
  it('merges edits per field, preserves tombstones, and replays deterministically', () => {
    let state = fixture();
    const original = expense(state);
    state = withEvent(state, { kind: 'expense.add', expense: original });
    state = withEvent(state, {
      kind: 'expense.edit',
      expenseId: original.id,
      patch: { description: 'New dinner' },
    });
    state = withEvent(state, { kind: 'expense.delete', expenseId: original.id });
    state = withEvent(state, {
      kind: 'expense.edit',
      expenseId: original.id,
      patch: { notes: 'Concurrent note' },
    });
    expect(state.expenses[0].description).toBe('New dinner');
    expect(state.expenses[0].notes).toBe('Concurrent note');
    expect(state.expenses[0].deletedAt).toBeTruthy();
    expect(balances(state).every((b) => b.net === 0)).toBe(true);
    expect(project([...state.events].reverse())).toEqual(state);
    expect(project([...state.events, ...state.events])).toEqual(state);
    state = withEvent(state, { kind: 'expense.restore', expenseId: original.id });
    expect(state.expenses[0].deletedAt).toBeUndefined();
    expect(balances(state)[0].net).toBe(7500);
    expect(original.description).toBe('Dinner');
  });
  it('rejects invalid split and payer sums, foreign members, and forbidden patches', () => {
    const state = fixture();
    const original = expense(state);
    expect(() => validateExpense(original, state)).not.toThrow();
    expect(() =>
      validateExpense({ ...original, payers: [{ userId: 'u0', amountPaid: 9999 }] }, state),
    ).toThrow('Payer amounts');
    expect(() =>
      validateExpense({ ...original, splits: [{ userId: 'u1', owedAmount: 9999 }] }, state),
    ).toThrow();
    expect(() =>
      validateExpense({ ...original, payers: [{ userId: 'outsider', amountPaid: 10000 }] }, state),
    ).toThrow();
    const withExpense = withEvent(state, { kind: 'expense.add', expense: original });
    const invalid = JSON.parse(
      JSON.stringify(
        makeEvent(state.trip.id, 'u0', { kind: 'expense.edit', expenseId: original.id, patch: {} }),
      ),
    );
    invalid.patch.amount = 5000;
    expect(() => validateEvent(invalid, withExpense)).toThrow('Invalid expense edit fields');
    invalid.patch = { ledger: { amount: 5000 } };
    expect(() => validateEvent(invalid, withExpense)).toThrow('complete ledger');
  });
  it('enforces trip lifecycle and leaving only with zero balance', () => {
    let state = fixture();
    state.trip.members[1].isGhost = false;
    state = withEvent(state, { kind: 'expense.add', expense: expense(state) });
    const create = state.events.find((e) => e.kind === 'member.add');
    if (create?.kind === 'member.add') create.member.isGhost = false;
    state = project(state.events);
    expect(() =>
      validateEvent(makeEvent(state.trip.id, 'u1', { kind: 'member.leave', userId: 'u1' }), state),
    ).toThrow('Settle your balance');
    expect(() =>
      validateEvent(makeEvent(state.trip.id, 'u0', { kind: 'member.leave', userId: 'u0' }), state),
    ).toThrow('Organizers');
    expect(() =>
      validateEvent(
        makeEvent(state.trip.id, 'u0', { kind: 'trip.status', status: 'closed' }),
        state,
      ),
    ).toThrow('transition');
    state = withEvent(state, { kind: 'trip.status', status: 'settling' });
    expect(() =>
      validateEvent(
        makeEvent(state.trip.id, 'u0', { kind: 'trip.status', status: 'closed' }),
        state,
      ),
    ).toThrow('Settle every balance');
    state = withEvent(state, { kind: 'expense.delete', expenseId: state.expenses[0].id });
    state = withEvent(state, { kind: 'trip.status', status: 'closed' });
    expect(() =>
      validateEvent(
        makeEvent(state.trip.id, 'u0', { kind: 'expense.add', expense: expense(state) }),
        state,
      ),
    ).toThrow('Reopen');
    expect(() =>
      validateEvent(
        makeEvent(state.trip.id, 'u0', { kind: 'trip.status', status: 'active' }),
        state,
      ),
    ).not.toThrow();
  });
  it('merges ghost balances without duplicating payer or split IDs', () => {
    let state = fixture(3);
    state = withEvent(state, { kind: 'expense.add', expense: expense(state) });
    const before = balances(state);
    state = withEvent(state, {
      kind: 'member.claim',
      ghostId: 'u1',
      user: { id: 'u0', displayName: 'Alice', username: 'alice', defaultCurrency: 'USD' },
    });
    expect(state.trip.members).toHaveLength(2);
    expect(state.expenses[0].splits).toHaveLength(2);
    expect(state.expenses[0].splitMethod).toBe('exact');
    expect(balances(state)[0].net).toBe(before[0].net + before[1].net);
    expect(() => validateExpense(state.expenses[0], state)).not.toThrow();
  });
});
