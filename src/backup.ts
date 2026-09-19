import { z } from 'zod';
import { project, validateEvent } from '../shared/events';
import { CURRENCIES, compareId } from '../shared/money';
import { CATEGORIES, METHODS, type TripEvent, type TripState, type User } from '../shared/types';
import type { Workspace } from './store';

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const id = z.string().min(1).max(100);
const timestamp = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const currency = z.string().refine((v) => CURRENCIES.includes(v), 'Unsupported currency');
const integer = z.number().int().safe().nonnegative();
const user = z.object({
  id,
  username: z.string().min(1).max(30),
  displayName: z.string().min(1).max(60),
  defaultCurrency: currency,
});
const member = z.object({
  id,
  name: z.string().min(1).max(60),
  isGhost: z.boolean(),
  role: z.enum(['organizer', 'member']),
  left: z.boolean().optional(),
});
const ledger = z.object({
  amount: integer,
  currency,
  fxRate: z.string().max(100),
  payers: z.array(z.object({ userId: id, amountPaid: integer })).max(50),
  splitMethod: z.enum(['even', 'shares', 'exact']),
  splits: z
    .array(
      z.object({
        userId: id,
        owedAmount: integer,
        shareWeight: z.string().max(100).optional(),
        rawInput: integer.optional(),
      }),
    )
    .max(50),
});
const fields = z.object({
  description: z.string().max(160),
  category: z.enum(CATEGORIES),
  date: z.string().max(10),
  notes: z.string().max(2000),
  attachments: z.array(z.string().max(250_000)).max(3),
});
const metadata = { id, tripId: id, actor: id, origin: id, updatedAt: timestamp };
const event = z.discriminatedUnion('kind', [
  z.object({
    ...metadata,
    kind: z.literal('trip.create'),
    trip: z.object({
      id,
      name: z.string().max(80),
      description: z.string().max(1000),
      baseCurrency: currency,
      startDate: z.string().max(10),
      endDate: z.string().max(10),
      status: z.enum(['active', 'settling', 'closed']),
      createdBy: id,
      createdAt: timestamp,
      members: z.array(member).min(1).max(50),
      deletedAt: timestamp.optional(),
    }),
  }),
  z.object({
    ...metadata,
    kind: z.literal('trip.edit'),
    patch: z
      .object({
        name: z.string().max(80).optional(),
        description: z.string().max(1000).optional(),
        dates: z
          .object({
            startDate: z.string().max(10),
            endDate: z.string().max(10),
          })
          .strict()
          .optional(),
      })
      .strict(),
  }),
  z.object({
    ...metadata,
    kind: z.literal('trip.status'),
    status: z.enum(['active', 'settling', 'closed']),
  }),
  z.object({ ...metadata, kind: z.literal('trip.delete') }),
  z.object({ ...metadata, kind: z.literal('member.add'), member }),
  z.object({ ...metadata, kind: z.literal('member.leave'), userId: id }),
  z.object({ ...metadata, kind: z.literal('member.claim'), ghostId: id, user }),
  z.object({
    ...metadata,
    kind: z.literal('expense.add'),
    expense: ledger.merge(fields).extend({
      id,
      createdBy: id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: timestamp.optional(),
    }),
  }),
  z.object({
    ...metadata,
    kind: z.literal('expense.edit'),
    expenseId: id,
    patch: fields.partial().extend({ ledger: ledger.strict().optional() }).strict(),
  }),
  z.object({ ...metadata, kind: z.literal('expense.delete'), expenseId: id }),
  z.object({ ...metadata, kind: z.literal('expense.restore'), expenseId: id }),
  z.object({
    ...metadata,
    kind: z.literal('expense.comment'),
    expenseId: id,
    text: z.string().max(1000),
  }),
  z.object({
    ...metadata,
    kind: z.literal('settlement.add'),
    settlement: z.object({
      id,
      fromUser: id,
      toUser: id,
      amount: integer,
      currency,
      method: z.enum(METHODS),
      note: z.string().max(1000),
      createdAt: timestamp,
    }),
  }),
]);
const workspaceSchema = z.object({
  mode: z.enum(['local', 'cloud']),
  user,
  events: z.array(event).max(10_000),
  pending: z.array(id).max(10_000),
  localTripMembers: z.record(id, id).optional(),
});
const envelope = z.object({
  format: z.literal('ensemble-backup'),
  version: z.literal(1),
  exportedAt: timestamp,
  workspace: workspaceSchema,
});

export interface ParsedBackup {
  workspace: Workspace;
  sourceMode: Workspace['mode'];
  trips: number;
  deletedTrips: number;
  expenses: number;
  pendingChanges: number;
}

export function serializeBackup(workspace: Workspace): string {
  return JSON.stringify(
    {
      format: 'ensemble-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace,
    },
    null,
    2,
  );
}

function readJSON(text: string): unknown {
  if (new Blob([text]).size > MAX_BACKUP_BYTES)
    throw new Error('Choose a JSON backup smaller than 25 MB.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'This file is not valid JSON. Choose an Ensemble JSON backup, not a CSV export.',
    );
  }
}

export async function parseBackup(text: string): Promise<ParsedBackup> {
  const input = readJSON(text);
  const wrapped =
    typeof input === 'object' &&
    input !== null &&
    ('format' in input || 'version' in input || 'workspace' in input);
  const parsed = wrapped ? envelope.safeParse(input) : workspaceSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid or unsupported backup (${issue.path.join('.') || 'file'}): ${issue.message}.`,
    );
  }
  const saved = 'workspace' in parsed.data ? parsed.data.workspace : parsed.data;
  const ids = new Set(saved.events.map((e) => e.id));
  if (ids.size !== saved.events.length) throw new Error('The backup contains duplicate event IDs.');
  if (
    new Set(saved.pending).size !== saved.pending.length ||
    saved.pending.some((id) => !ids.has(id))
  )
    throw new Error('The backup references missing or duplicate pending changes.');
  if (saved.mode === 'local' && saved.pending.length)
    throw new Error('A local backup cannot contain a cloud sync queue.');
  const states = await validateHistory(saved.events);
  if (saved.localTripMembers) {
    if (saved.mode !== 'local')
      throw new Error('Shared workspaces cannot contain local trip identities.');
    for (const [tripId, memberId] of Object.entries(saved.localTripMembers)) {
      const state = states.find((s) => s.trip.id === tripId);
      if (!state?.trip.members.some((m) => m.id === memberId && !m.isGhost))
        throw new Error('The backup references an invalid local trip participant.');
    }
  }
  return {
    workspace: {
      mode: 'local',
      user: saved.user,
      events: saved.events,
      pending: [],
      friends: [],
      notices: [],
      lastSynced: null,
      ...(saved.localTripMembers ? { localTripMembers: saved.localTripMembers } : {}),
    },
    sourceMode: saved.mode,
    trips: states.filter(
      (s) =>
        !s.trip.deletedAt &&
        s.trip.members.some(
          (m) => m.id === (saved.localTripMembers?.[s.trip.id] ?? saved.user.id) && !m.left,
        ),
    ).length,
    deletedTrips: states.filter((s) => s.trip.deletedAt).length,
    expenses: states.reduce((sum, s) => sum + s.expenses.length, 0),
    pendingChanges: saved.pending.length,
  };
}

async function validateHistory(events: TripEvent[]): Promise<TripState[]> {
  if (new Set(events.map((e) => e.id)).size !== events.length)
    throw new Error('The backup contains duplicate event IDs.');
  const groups = new Map<string, TripEvent[]>();
  const ordered = [...events].sort(
    (a, b) => compareId(a.updatedAt, b.updatedAt) || compareId(a.id, b.id),
  );
  for (const [index, change] of ordered.entries()) {
    const history = groups.get(change.tripId) ?? [];
    try {
      validateEvent(
        change,
        history.length ? project(history) : null,
        change.kind === 'member.add' && !change.member.isGhost,
      );
    } catch (error) {
      throw new Error(
        `Cannot restore ${change.kind} in trip ${change.tripId}: ${
          error instanceof Error ? error.message : 'Invalid event history.'
        }`,
      );
    }
    history.push(change);
    groups.set(change.tripId, history);
    if (index % 25 === 24) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return [...groups.values()].map(project);
}

const tripEnvelope = z.object({
  format: z.literal('ensemble-trip'),
  version: z.literal(1),
  exportedAt: timestamp,
  exportedBy: user,
  tripId: id,
  events: z.array(event).min(1).max(10_000),
});

export interface ParsedTripBackup {
  state: TripState;
  exportedBy: User;
}

export function serializeTrip(state: TripState, exportedBy: User): string {
  return JSON.stringify(
    {
      format: 'ensemble-trip',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy,
      tripId: state.trip.id,
      events: state.events,
    },
    null,
    2,
  );
}

export async function parseTripBackup(text: string): Promise<ParsedTripBackup> {
  const parsed = tripEnvelope.safeParse(readJSON(text));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid trip JSON (${issue.path.join('.') || 'file'}): ${issue.message}. Choose a single-trip export, not a full workspace backup.`,
    );
  }
  const saved = parsed.data;
  if (saved.events.some((e) => e.tripId !== saved.tripId))
    throw new Error('A trip JSON file must contain exactly one trip.');
  const [state] = await validateHistory(saved.events);
  if (state.trip.deletedAt) throw new Error('Deleted trips cannot be imported as active copies.');
  return { state, exportedBy: saved.exportedBy };
}

export function copyTrip(backup: ParsedTripBackup, memberId: string): TripState {
  const source = backup.state;
  if (!source.trip.members.some((m) => m.id === memberId && !m.isGhost && !m.left))
    throw new Error('Choose a current non-placeholder participant to represent you.');
  if (source.trip.deletedAt) throw new Error('Deleted trips cannot be imported as active copies.');
  const tripId = crypto.randomUUID();
  const eventPrefix = crypto.randomUUID();
  const expenses = new Map(source.expenses.map((expense) => [expense.id, crypto.randomUUID()]));
  const events = structuredClone(source.events);
  for (const [index, change] of events.entries()) {
    // Preserve tie ordering and participant IDs: both affect history and rounded amounts.
    change.id = `${eventPrefix}:${String(index).padStart(5, '0')}`;
    change.tripId = tripId;
    if (change.kind === 'trip.create') change.trip.id = tripId;
    if (change.kind === 'expense.add') change.expense.id = expenses.get(change.expense.id)!;
    if ('expenseId' in change) change.expenseId = expenses.get(change.expenseId)!;
    if (change.kind === 'settlement.add') change.settlement.id = crypto.randomUUID();
  }
  return project(events);
}
