import type { Balance, Expense, Payer, Split, SplitMethod, Transfer, TripState } from './types';

export const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
  'KRW',
  'CHF',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'THB',
  'MXN',
  'NZD',
  'TWD',
  'VND',
  'IDR',
  'BRL',
  'AED',
  'KWD',
  'BHD',
];
export const MAX_MONEY = 100_000_000_000;
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function decimals(currency: string): number {
  assert(CURRENCIES.includes(currency), 'Choose a supported currency.');
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}
export function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    value / 10 ** decimals(currency),
  );
}
export function amountInput(value: number, currency: string): string {
  return (value / 10 ** decimals(currency)).toFixed(decimals(currency));
}
export function minor(input: string, currency: string): number {
  const digits = decimals(currency);
  assert(/^\d+(\.\d+)?$/.test(input.trim()), 'Enter a valid, non-negative amount.');
  const [whole, fraction = ''] = input.trim().split('.');
  assert(fraction.length <= digits, `${currency} supports ${digits} decimal places.`);
  const result = Number(
    BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0'),
  );
  assert(Number.isSafeInteger(result) && result <= MAX_MONEY, 'Amount is too large.');
  return result;
}
export function rational(value: string): { numerator: bigint; denominator: bigint } {
  assert(
    /^\d{1,12}(\.\d{1,8})?$/.test(value),
    'Use a positive decimal with at most 8 decimal places.',
  );
  const [whole, fraction = ''] = value.split('.');
  return { numerator: BigInt(whole + fraction), denominator: 10n ** BigInt(fraction.length) };
}
export function allocate(total: number, rows: { userId: string; weight: bigint }[]): Split[] {
  assert(Number.isSafeInteger(total) && total >= 0 && total <= MAX_MONEY, 'Invalid amount.');
  assert(
    rows.length > 0 && new Set(rows.map((r) => r.userId)).size === rows.length,
    'Choose distinct participants.',
  );
  assert(
    rows.every((r) => r.weight >= 0n),
    'Weights cannot be negative.',
  );
  const weight = rows.reduce((sum, r) => sum + r.weight, 0n);
  assert(weight > 0n, 'At least one share must be greater than zero.');
  const parts = rows.map((r) => ({
    userId: r.userId,
    owedAmount: Number((BigInt(total) * r.weight) / weight),
    remainder: (BigInt(total) * r.weight) % weight,
  }));
  const left = total - parts.reduce((sum, r) => sum + r.owedAmount, 0);
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? compareId(a.userId, b.userId)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; i < left; i++) parts[i].owedAmount++;
  return parts
    .sort((a, b) => compareId(a.userId, b.userId))
    .map(({ userId, owedAmount }) => ({ userId, owedAmount }));
}
export function splitAmount(
  total: number,
  method: SplitMethod,
  rows: { userId: string; value: string }[],
  currency: string,
): Split[] {
  assert(
    rows.length > 0 && new Set(rows.map((r) => r.userId)).size === rows.length,
    'Select at least one participant, without duplicates.',
  );
  if (method === 'exact') {
    const splits = rows.map((r) => ({
      userId: r.userId,
      owedAmount: minor(r.value, currency),
      rawInput: minor(r.value, currency),
    }));
    const sum = splits.reduce((n, r) => n + r.owedAmount, 0);
    assert(
      sum === total,
      `Exact amounts differ from the total by ${money(Math.abs(total - sum), currency)} (${sum < total ? 'under' : 'over'}).`,
    );
    return splits.sort((a, b) => compareId(a.userId, b.userId));
  }
  const weights = rows.map((r) => ({ userId: r.userId, value: method === 'even' ? '1' : r.value }));
  const parsed = weights.map((r) => ({ ...r, ...rational(r.value) }));
  const denominator = parsed.reduce((d, r) => (r.denominator > d ? r.denominator : d), 1n);
  return allocate(
    total,
    parsed.map((r) => ({ userId: r.userId, weight: r.numerator * (denominator / r.denominator) })),
  ).map((r) =>
    method === 'shares'
      ? { ...r, shareWeight: weights.find((w) => w.userId === r.userId)!.value }
      : r,
  );
}
export function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function convertedTotal(
  expense: Pick<Expense, 'amount' | 'currency' | 'fxRate'>,
  base: string,
): number {
  if (expense.currency === base) return expense.amount;
  const { numerator, denominator } = rational(expense.fxRate);
  assert(numerator > 0n, 'Exchange rate must be greater than zero.');
  const n = BigInt(expense.amount) * numerator * 10n ** BigInt(decimals(base));
  const d = denominator * 10n ** BigInt(decimals(expense.currency));
  const result = Number((2n * n + d) / (2n * d));
  assert(Number.isSafeInteger(result) && result <= MAX_MONEY, 'Converted amount is too large.');
  return result;
}
export function baseAmounts(
  expense: Expense,
  base: string,
): { payers: Payer[]; splits: Split[]; total: number } {
  const total = convertedTotal(expense, base);
  return {
    total,
    payers: allocate(
      total,
      expense.payers.map((p) => ({ userId: p.userId, weight: BigInt(p.amountPaid) })),
    ).map((r) => ({ userId: r.userId, amountPaid: r.owedAmount })),
    splits: allocate(
      total,
      expense.splits.map((s) => ({ userId: s.userId, weight: BigInt(s.owedAmount) })),
    ),
  };
}
export function balances(state: TripState): Balance[] {
  const rows = new Map(
    state.trip.members.map((m) => [m.id, { userId: m.id, paid: 0, owed: 0, net: 0 }]),
  );
  for (const expense of state.expenses.filter((e) => !e.deletedAt)) {
    const base = baseAmounts(expense, state.trip.baseCurrency);
    for (const p of base.payers) {
      const r = rows.get(p.userId)!;
      r.paid += p.amountPaid;
      r.net += p.amountPaid;
    }
    for (const s of base.splits) {
      const r = rows.get(s.userId)!;
      r.owed += s.owedAmount;
      r.net -= s.owedAmount;
    }
  }
  for (const s of state.settlements) {
    rows.get(s.fromUser)!.net += s.amount;
    rows.get(s.toUser)!.net -= s.amount;
  }
  const result = [...rows.values()];
  assert(
    result.every((r) => [r.paid, r.owed, r.net].every(Number.isSafeInteger)),
    'Trip totals exceed the supported range.',
  );
  assert(result.reduce((sum, r) => sum + r.net, 0) === 0, 'Balances must sum to zero.');
  return result;
}
function netTransfers(transfers: Transfer[]): Transfer[] {
  const pairs = new Map<string, Transfer>();
  for (const { fromUser: from, toUser: to, amount } of transfers) {
    if (from === to || amount === 0) continue;
    const [a, b] = [from, to].sort(compareId);
    const key = JSON.stringify([a, b]);
    const row = pairs.get(key) ?? { fromUser: a, toUser: b, amount: 0 };
    row.amount += from === a ? amount : -amount;
    pairs.set(key, row);
  }
  return [...pairs.values()]
    .filter((r) => r.amount !== 0)
    .map((r) => (r.amount > 0 ? r : { fromUser: r.toUser, toUser: r.fromUser, amount: -r.amount }));
}
export function expenseTransfers(expense: Expense, currency = expense.currency): Transfer[] {
  if (expense.deletedAt) return [];
  const { payers, splits } = baseAmounts(expense, currency);
  const transfers: Transfer[] = [];
  // Allocate against remaining payer capacity so multi-payer rounding preserves both margins.
  const remaining = payers.map((p) => ({ ...p }));
  for (const s of [...splits].sort((a, b) => compareId(a.userId, b.userId))) {
    if (!s.owedAmount) continue;
    const parts = allocate(
      s.owedAmount,
      remaining.map((p) => ({ userId: p.userId, weight: BigInt(p.amountPaid) })),
    );
    for (const part of parts) {
      transfers.push({ fromUser: s.userId, toUser: part.userId, amount: part.owedAmount });
      remaining.find((p) => p.userId === part.userId)!.amountPaid -= part.owedAmount;
    }
  }
  return netTransfers(transfers);
}
export function pairwise(state: TripState): Transfer[] {
  return netTransfers([
    ...state.expenses.flatMap((e) => expenseTransfers(e, state.trip.baseCurrency)),
    ...state.settlements.map((s) => ({
      fromUser: s.fromUser,
      toUser: s.toUser,
      amount: -s.amount,
    })),
  ]);
}
export function greedy(input: Pick<Balance, 'userId' | 'net'>[]): Transfer[] {
  assert(
    input.every((r) => Number.isSafeInteger(r.net)) && input.reduce((s, r) => s + r.net, 0) === 0,
    'Invalid net balances.',
  );
  const rows = input.map((r) => ({ ...r }));
  const result: Transfer[] = [];
  while (true) {
    const debtors = rows
      .filter((r) => r.net < 0)
      .sort((a, b) => a.net - b.net || compareId(a.userId, b.userId));
    const creditors = rows
      .filter((r) => r.net > 0)
      .sort((a, b) => b.net - a.net || compareId(a.userId, b.userId));
    if (!debtors.length) break;
    const d = debtors[0],
      c = creditors[0];
    const amount = Math.min(-d.net, c.net);
    result.push({ fromUser: d.userId, toUser: c.userId, amount });
    d.net += amount;
    c.net -= amount;
  }
  return result;
}
export function settlementPlan(
  input: Pick<Balance, 'userId' | 'net'>[],
  optimal = true,
): { transfers: Transfer[]; optimal: boolean } {
  const baseline = greedy(input);
  const rows = input.filter((r) => r.net !== 0).sort((a, b) => compareId(a.userId, b.userId));
  if (!optimal || rows.length > 15) return { transfers: baseline, optimal: rows.length <= 2 };
  const count = 1 << rows.length;
  const sums = new Float64Array(count);
  const groups = new Uint8Array(count);
  const previous = new Int8Array(count);
  // A maximum chain of zero-sum prefixes partitions the members into the most
  // independent zero-sum groups, giving the true minimum N - groups transfers.
  for (let mask = 1; mask < count; mask++) {
    const bit = mask & -mask;
    sums[mask] = sums[mask ^ bit] + rows[31 - Math.clz32(bit)].net;
    let best = -1;
    for (let i = 0; i < rows.length; i++) {
      if (!(mask & (1 << i))) continue;
      const candidate = groups[mask ^ (1 << i)] + (sums[mask] === 0 ? 1 : 0);
      if (candidate > best) {
        best = candidate;
        previous[mask] = i;
      }
    }
    groups[mask] = best;
  }
  let mask = count - 1;
  const transfers: Transfer[] = [];
  let subset: typeof rows = [];
  while (mask) {
    const i = previous[mask];
    subset.push(rows[i]);
    mask ^= 1 << i;
    if (sums[mask] === 0) {
      transfers.push(...greedy(subset));
      subset = [];
    }
  }
  return { transfers, optimal: true };
}
