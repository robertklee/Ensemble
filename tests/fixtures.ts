import { makeEvent, project } from '../shared/events';
import { splitAmount } from '../shared/money';
import type { EventData, Expense, TripEvent, TripState } from '../shared/types';

export function fixture(memberCount = 4): TripState {
  const names = ['Alice', 'Bob', 'Carol', 'Dave'];
  const events: TripEvent[] = [];
  const tripId = 'trip-1';
  const start = '2026-09-12T09:00:00.000Z';
  const create = makeEvent(tripId, 'u0', {
    kind: 'trip.create',
    trip: {
      id: tripId,
      name: 'Weekend Cabin',
      description: '',
      baseCurrency: 'USD',
      startDate: '',
      endDate: '',
      status: 'active',
      createdBy: 'u0',
      createdAt: start,
      members: [{ id: 'u0', name: 'Alice', isGhost: false, role: 'organizer' }],
    },
  });
  create.updatedAt = start;
  events.push(create);
  for (let i = 1; i < memberCount; i++) {
    const event = makeEvent(tripId, 'u0', {
      kind: 'member.add',
      member: { id: `u${i}`, name: names[i] ?? `Member ${i}`, role: 'member', isGhost: true },
    });
    event.updatedAt = new Date(Date.parse(start) + i).toISOString();
    events.push(event);
  }
  return project(events);
}
export function expense(state: TripState, overrides: Partial<Expense> = {}): Expense {
  return {
    id: crypto.randomUUID(),
    description: 'Dinner',
    category: 'food',
    date: '2026-09-12',
    amount: 10000,
    currency: 'USD',
    fxRate: '1',
    payers: [{ userId: 'u0', amountPaid: 10000 }],
    splitMethod: 'even',
    splits: splitAmount(
      10000,
      'even',
      state.trip.members.map((m) => ({ userId: m.id, value: '1' })),
      'USD',
    ),
    notes: '',
    attachments: [],
    createdBy: 'u0',
    createdAt: '2026-09-12T12:00:00.000Z',
    updatedAt: '2026-09-12T12:00:00.000Z',
    ...overrides,
  };
}
export function withEvent(state: TripState, data: EventData, actor = 'u0'): TripState {
  const event = makeEvent(state.trip.id, actor, data);
  event.updatedAt = new Date(
    Math.max(...state.events.map((e) => Date.parse(e.updatedAt))) + 1,
  ).toISOString();
  return project([...state.events, event]);
}
