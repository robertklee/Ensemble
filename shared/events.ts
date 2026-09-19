import {
  assert,
  balances,
  CURRENCIES,
  compareId,
  convertedTotal,
  MAX_MONEY,
  splitAmount,
} from './money';
import {
  CATEGORIES,
  METHODS,
  type EventData,
  type Expense,
  type Member,
  type TripEvent,
  type TripState,
} from './types';

export function makeEvent(tripId: string, actor: string, data: EventData): TripEvent {
  return {
    ...data,
    id: crypto.randomUUID(),
    tripId,
    actor,
    origin: actor,
    updatedAt: new Date().toISOString(),
  };
}
export function project(events: TripEvent[]): TripState {
  const ordered = [...new Map(events.map((e) => [e.id, e])).values()].sort(
    (a, b) => compareId(a.updatedAt, b.updatedAt) || compareId(a.id, b.id),
  );
  const initial = ordered.find((e) => e.kind === 'trip.create');
  assert(initial?.kind === 'trip.create', 'Trip is missing its creation event.');
  const state: TripState = {
    trip: structuredClone(initial.trip),
    expenses: [],
    settlements: [],
    comments: [],
    events: ordered,
  };
  for (const event of ordered) {
    switch (event.kind) {
      case 'trip.create':
        break;
      case 'trip.status':
        state.trip.status = event.status;
        break;
      case 'trip.delete':
        state.trip.deletedAt = event.updatedAt;
        break;
      case 'member.add': {
        const old = state.trip.members.find((m) => m.id === event.member.id);
        if (old) old.left = false;
        else state.trip.members.push(structuredClone(event.member));
        break;
      }
      case 'member.leave':
        state.trip.members.find((m) => m.id === event.userId)!.left = true;
        break;
      case 'member.claim': {
        const ghost = state.trip.members.find((m) => m.id === event.ghostId)!;
        const existing = state.trip.members.find((m) => m.id === event.user.id);
        if (existing) {
          existing.left = false;
          state.trip.members = state.trip.members.filter((m) => m.id !== ghost.id);
        } else {
          ghost.id = event.user.id;
          ghost.name = event.user.displayName;
          ghost.isGhost = false;
        }
        for (const e of state.expenses) {
          for (const p of e.payers) if (p.userId === event.ghostId) p.userId = event.user.id;
          e.payers = [...new Set(e.payers.map((p) => p.userId))].map((userId) => ({
            userId,
            amountPaid: e.payers
              .filter((p) => p.userId === userId)
              .reduce((sum, p) => sum + p.amountPaid, 0),
          }));
          if (e.splits.some((s) => s.userId === event.ghostId)) {
            for (const s of e.splits) if (s.userId === event.ghostId) s.userId = event.user.id;
            e.splits = [...new Set(e.splits.map((s) => s.userId))].map((userId) => {
              const owedAmount = e.splits
                .filter((s) => s.userId === userId)
                .reduce((sum, s) => sum + s.owedAmount, 0);
              return { userId, owedAmount, rawInput: owedAmount };
            });
            e.splitMethod = 'exact';
          }
        }
        for (const s of state.settlements) {
          if (s.fromUser === event.ghostId) s.fromUser = event.user.id;
          if (s.toUser === event.ghostId) s.toUser = event.user.id;
        }
        break;
      }
      case 'expense.add':
        if (!state.expenses.some((e) => e.id === event.expense.id))
          state.expenses.push(structuredClone(event.expense));
        break;
      case 'expense.edit': {
        const expense = state.expenses.find((e) => e.id === event.expenseId)!;
        const { ledger, ...fields } = event.patch;
        Object.assign(expense, structuredClone(fields), ledger ? structuredClone(ledger) : {}, {
          updatedAt: event.updatedAt,
        });
        break;
      }
      case 'expense.delete':
        state.expenses.find((e) => e.id === event.expenseId)!.deletedAt = event.updatedAt;
        break;
      case 'expense.restore':
        delete state.expenses.find((e) => e.id === event.expenseId)!.deletedAt;
        break;
      case 'expense.comment':
        state.comments.push({
          id: event.id,
          expenseId: event.expenseId,
          actor: event.actor,
          text: event.text,
          createdAt: event.updatedAt,
        });
        break;
      case 'settlement.add':
        if (!state.settlements.some((s) => s.id === event.settlement.id))
          state.settlements.push(structuredClone(event.settlement));
        break;
    }
  }
  return state;
}
function text(
  value: unknown,
  label: string,
  max: number,
  required = true,
): asserts value is string {
  assert(
    typeof value === 'string' && (!required || value.trim().length > 0) && value.length <= max,
    `${label} must be ${required ? '1' : '0'}–${max} characters.`,
  );
}
function date(value: string, required = false) {
  assert(
    (!required && value === '') ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value),
    'Enter a valid date.',
  );
}
function positiveMoney(value: number) {
  assert(
    Number.isSafeInteger(value) && value > 0 && value <= MAX_MONEY,
    'Amount must be a positive supported integer in minor units.',
  );
}
function validateMember(member: Member) {
  text(member.id, 'Member ID', 100);
  text(member.name, 'Member name', 60);
  assert(
    typeof member.isGhost === 'boolean' && ['organizer', 'member'].includes(member.role),
    'Invalid member.',
  );
}
export function validateExpense(expense: Expense, state: TripState, allowFormerMembers = false) {
  text(expense.id, 'Expense ID', 100);
  text(expense.description, 'Description', 160);
  text(expense.notes, 'Notes', 2000, false);
  assert(CATEGORIES.includes(expense.category), 'Choose a valid category.');
  date(expense.date, true);
  positiveMoney(expense.amount);
  assert(CURRENCIES.includes(expense.currency), 'Unsupported currency.');
  assert(['even', 'shares', 'exact'].includes(expense.splitMethod), 'Choose a valid split method.');
  assert(
    expense.currency !== state.trip.baseCurrency || expense.fxRate === '1',
    'Base-currency exchange rate must be 1.',
  );
  convertedTotal(expense, state.trip.baseCurrency);
  const ids = state.trip.members.filter((m) => allowFormerMembers || !m.left).map((m) => m.id);
  assert(
    Array.isArray(expense.payers) &&
      expense.payers.length > 0 &&
      expense.payers.length <= ids.length,
    'Choose at least one payer.',
  );
  assert(
    new Set(expense.payers.map((p) => p.userId)).size === expense.payers.length,
    'A payer is listed twice.',
  );
  assert(
    expense.payers.every(
      (p) => ids.includes(p.userId) && Number.isSafeInteger(p.amountPaid) && p.amountPaid >= 0,
    ),
    'Payers must be current members with valid amounts.',
  );
  assert(
    expense.payers.reduce((sum, p) => sum + p.amountPaid, 0) === expense.amount,
    'Payer amounts must equal the expense total.',
  );
  assert(
    Array.isArray(expense.splits) &&
      expense.splits.length > 0 &&
      expense.splits.length <= ids.length,
    'Choose participants.',
  );
  assert(
    expense.splits.every(
      (s) => ids.includes(s.userId) && Number.isSafeInteger(s.owedAmount) && s.owedAmount >= 0,
    ),
    'Participants must be current members with valid amounts.',
  );
  const resolved = splitAmount(
    expense.amount,
    expense.splitMethod,
    expense.splits.map((s) => ({
      userId: s.userId,
      value:
        expense.splitMethod === 'shares'
          ? (s.shareWeight ?? '')
          : expense.splitMethod === 'exact'
            ? (s.rawInput ?? s.owedAmount).toString()
            : '1',
    })),
    'JPY',
  );
  assert(
    resolved.every(
      (r) => expense.splits.find((s) => s.userId === r.userId)?.owedAmount === r.owedAmount,
    ),
    'Split amounts do not match the selected split method.',
  );
  assert(
    Array.isArray(expense.attachments) && expense.attachments.length <= 3,
    'Attach up to 3 receipt photos.',
  );
  assert(
    expense.attachments.every(
      (a) =>
        typeof a === 'string' &&
        a.length <= 250_000 &&
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(a),
    ),
    'Receipts must be JPEG, PNG or WebP images under 180 KB.',
  );
}
export function validateEvent(
  event: TripEvent,
  current: TripState | null,
  trustedMembership = false,
) {
  text(event.id, 'Event ID', 100);
  text(event.tripId, 'Trip ID', 100);
  text(event.actor, 'Actor', 100);
  text(event.origin, 'Origin', 100);
  assert(
    typeof event.updatedAt === 'string' && !Number.isNaN(Date.parse(event.updatedAt)),
    'Invalid event timestamp.',
  );
  if (event.kind === 'trip.create') {
    assert(!current, 'Trip already exists.');
    const t = event.trip;
    assert(
      t.id === event.tripId &&
        t.createdBy === event.actor &&
        t.status === 'active' &&
        t.deletedAt === undefined,
      'Invalid trip creation.',
    );
    text(t.name, 'Trip name', 80);
    text(t.description, 'Description', 1000, false);
    assert(CURRENCIES.includes(t.baseCurrency), 'Unsupported currency.');
    date(t.startDate);
    date(t.endDate);
    assert(
      !t.startDate || !t.endDate || t.startDate <= t.endDate,
      'End date must be after start date.',
    );
    assert(
      t.members.length === 1 &&
        t.members[0].id === event.actor &&
        t.members[0].role === 'organizer' &&
        !t.members[0].isGhost,
      'A new trip starts with its organizer.',
    );
    validateMember(t.members[0]);
    return;
  }
  assert(current, 'Trip not found.');
  assert(event.tripId === current.trip.id, 'Event belongs to another trip.');
  const actor = current.trip.members.find((m) => m.id === event.actor && !m.left && !m.isGhost);
  assert(actor || trustedMembership, 'Only current members can change this trip.');
  const organizer = actor?.role === 'organizer';
  assert(!current.trip.deletedAt, 'This trip has been deleted. No further changes are allowed.');
  if (event.kind === 'trip.delete') {
    assert(organizer, 'Only the organizer can delete this trip.');
    return;
  }
  if (event.kind === 'trip.status') {
    assert(organizer, 'Only the organizer can change trip status.');
    const allowed =
      current.trip.status === 'active'
        ? ['settling']
        : current.trip.status === 'settling'
          ? ['active', 'closed']
          : ['active'];
    assert(allowed.includes(event.status), 'Invalid trip status transition.');
    if (event.status === 'closed')
      assert(
        balances(current).every((b) => b.net === 0),
        'Settle every balance before closing the trip.',
      );
    return;
  }
  assert(current.trip.status !== 'closed', 'Reopen this trip before making changes.');
  switch (event.kind) {
    case 'member.add':
      assert(
        trustedMembership || (organizer && event.member.isGhost),
        'Only organizers can add placeholders; use an invitation for an account.',
      );
      validateMember(event.member);
      assert(
        event.member.role === 'member' && !event.member.left,
        'New members must have the member role.',
      );
      assert(
        !current.trip.members.some((m) => m.id === event.member.id && !m.left),
        'Member already belongs to this trip.',
      );
      assert(
        current.trip.members.length < 50 ||
          current.trip.members.some((m) => m.id === event.member.id),
        'Trips support up to 50 members.',
      );
      break;
    case 'member.leave':
      assert(event.userId === event.actor && !organizer, 'Organizers cannot leave their own trip.');
      assert(
        balances(current).find((b) => b.userId === event.userId)?.net === 0,
        'Settle your balance before leaving.',
      );
      break;
    case 'member.claim':
      assert(organizer, 'Only the organizer can merge a placeholder.');
      assert(
        current.trip.members.some((m) => m.id === event.ghostId && m.isGhost && !m.left),
        'Placeholder not found.',
      );
      assert(
        current.trip.members.some((m) => m.id === event.user.id && !m.isGhost && !m.left),
        'The account must join this trip before merging.',
      );
      break;
    case 'expense.add':
      assert(!current.expenses.some((e) => e.id === event.expense.id), 'Expense already exists.');
      assert(
        event.expense.createdBy === event.actor && !event.expense.deletedAt,
        'Invalid expense creator.',
      );
      validateExpense(event.expense, current);
      break;
    case 'expense.edit': {
      const expense = current.expenses.find((e) => e.id === event.expenseId);
      assert(expense, 'Expense not found.');
      assert(
        Object.keys(event.patch).every((k) =>
          ['description', 'category', 'date', 'notes', 'attachments', 'ledger'].includes(k),
        ),
        'Invalid expense edit fields.',
      );
      if (event.patch.ledger)
        assert(
          Object.keys(event.patch.ledger).sort().join(',') ===
            'amount,currency,fxRate,payers,splitMethod,splits',
          'Financial changes must include the complete ledger.',
        );
      const { ledger, ...fields } = event.patch;
      validateExpense({ ...expense, ...fields, ...ledger }, current, !ledger);
      break;
    }
    case 'expense.delete':
    case 'expense.restore':
      assert(
        current.expenses.some((e) => e.id === event.expenseId),
        'Expense not found.',
      );
      if (event.kind === 'expense.restore') {
        const expense = current.expenses.find((e) => e.id === event.expenseId)!;
        assert(expense.deletedAt, 'Expense is not deleted.');
        validateExpense(expense, current);
      }
      break;
    case 'expense.comment':
      assert(
        current.expenses.some((e) => e.id === event.expenseId && !e.deletedAt),
        'Expense not found.',
      );
      text(event.text, 'Comment', 1000);
      break;
    case 'settlement.add': {
      const s = event.settlement;
      text(s.id, 'Settlement ID', 100);
      text(s.note, 'Note', 1000, false);
      assert(!current.settlements.some((old) => old.id === s.id), 'Settlement already recorded.');
      positiveMoney(s.amount);
      assert(
        s.currency === current.trip.baseCurrency && METHODS.includes(s.method),
        'Use the trip currency and a supported payment method.',
      );
      assert(
        s.fromUser !== s.toUser &&
          [s.fromUser, s.toUser].every((id) =>
            current.trip.members.some((m) => m.id === id && !m.left),
          ),
        'Choose two different current members.',
      );
      break;
    }
    default:
      throw new Error('Unknown event type.');
  }
  balances(project([...current.events, event]));
}
export function eventLabel(event: TripEvent, memberName: (id: string) => string): string {
  switch (event.kind) {
    case 'trip.create':
      return 'created the trip';
    case 'trip.status':
      return `changed the trip to ${event.status}`;
    case 'trip.delete':
      return 'deleted the trip';
    case 'member.add':
      return `added ${event.member.name}`;
    case 'member.leave':
      return 'left the trip';
    case 'member.claim':
      return `merged a placeholder into ${event.user.displayName}`;
    case 'expense.add':
      return `added “${event.expense.description}”`;
    case 'expense.edit':
      return 'edited an expense';
    case 'expense.delete':
      return 'deleted an expense';
    case 'expense.restore':
      return 'restored an expense';
    case 'expense.comment':
      return 'commented on an expense';
    case 'settlement.add':
      return `recorded a payment from ${memberName(event.settlement.fromUser)} to ${memberName(event.settlement.toUser)}`;
  }
}
