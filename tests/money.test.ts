import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  allocate,
  balances,
  baseAmounts,
  convertedTotal,
  expenseTransfers,
  greedy,
  minor,
  pairwise,
  settlementPlan,
  splitAmount,
} from '../shared/money';
import { fixture, expense, withEvent } from './fixtures';

describe('per-expense repayment hints', () => {
  it('identifies who repays a single payer, excluding their own share', () => {
    const state = fixture();
    expect(expenseTransfers(expense(state))).toEqual([
      { fromUser: 'u1', toUser: 'u0', amount: 2500 },
      { fromUser: 'u2', toUser: 'u0', amount: 2500 },
      { fromUser: 'u3', toUser: 'u0', amount: 2500 },
    ]);
  });
  it('nets reciprocal multi-payer debts while preserving both directions with different people', () => {
    const state = fixture(3);
    const e = expense(state, {
      amount: 900,
      payers: [
        { userId: 'u0', amountPaid: 300 },
        { userId: 'u1', amountPaid: 600 },
      ],
      splits: state.trip.members.map((m) => ({ userId: m.id, owedAmount: 300 })),
    });
    expect(expenseTransfers(e)).toEqual([
      { fromUser: 'u0', toUser: 'u1', amount: 100 },
      { fromUser: 'u2', toUser: 'u0', amount: 100 },
      { fromUser: 'u2', toUser: 'u1', amount: 200 },
    ]);
    expect(
      expenseTransfers({ ...e, payers: [...e.payers].reverse(), splits: [...e.splits].reverse() }),
    ).toEqual(expenseTransfers(e));
  });
  it('omits deleted expenses, self-payments, uninvolved people and zero shares', () => {
    const state = fixture();
    const e = expense(state, {
      splits: [
        { userId: 'u0', owedAmount: 10000 },
        { userId: 'u1', owedAmount: 0 },
      ],
    });
    expect(expenseTransfers(e)).toEqual([]);
    expect(expenseTransfers({ ...expense(state), deletedAt: new Date().toISOString() })).toEqual(
      [],
    );
    const others = expense(state, {
      payers: [{ userId: 'u1', amountPaid: 10000 }],
      splits: [{ userId: 'u2', owedAmount: 10000 }],
    });
    expect(expenseTransfers(others)).toEqual([{ fromUser: 'u2', toUser: 'u1', amount: 10000 }]);
  });
  it('uses the expense currency by default and does not attribute trip payments to expenses', () => {
    let state = fixture(2);
    const e = expense(state, { currency: 'EUR', fxRate: '1.25' });
    state = withEvent(state, { kind: 'expense.add', expense: e });
    state = withEvent(state, {
      kind: 'settlement.add',
      settlement: {
        id: 'payment',
        fromUser: 'u1',
        toUser: 'u0',
        amount: 6250,
        currency: 'USD',
        method: 'cash',
        note: '',
        createdAt: new Date().toISOString(),
      },
    });
    expect(pairwise(state)).toEqual([]);
    expect(expenseTransfers(state.expenses[0])).toEqual([
      { fromUser: 'u1', toUser: 'u0', amount: 5000 },
    ]);
    expect(expenseTransfers(e, 'USD')).toEqual([{ fromUser: 'u1', toUser: 'u0', amount: 6250 }]);
  });
});

describe('integer money and deterministic splitting', () => {
  it('parses minor units without floating-point drift and respects currency precision', () => {
    expect(minor('1.01', 'USD')).toBe(101);
    expect(minor('100', 'JPY')).toBe(100);
    expect(minor('1.001', 'KWD')).toBe(1001);
    for (const input of ['-1', '1e2', '1.001', 'Infinity', '', '0x11'])
      expect(() => minor(input, 'USD')).toThrow();
    expect(() => minor('1.1', 'JPY')).toThrow();
  });
  it('allocates the extra cent by user ID regardless of input order', () => {
    expect(
      splitAmount(
        10000,
        'even',
        [
          { userId: 'c', value: '' },
          { userId: 'b', value: '' },
          { userId: 'a', value: '' },
        ],
        'USD',
      ),
    ).toEqual([
      { userId: 'a', owedAmount: 3334 },
      { userId: 'b', owedAmount: 3333 },
      { userId: 'c', owedAmount: 3333 },
    ]);
  });
  it('supports decimal share weights, zero shares and exact amounts', () => {
    expect(
      splitAmount(
        12000,
        'shares',
        [
          { userId: 'a', value: '0.2' },
          { userId: 'b', value: '0.1' },
          { userId: 'c', value: '0.1' },
        ],
        'USD',
      ).map((s) => s.owedAmount),
    ).toEqual([6000, 3000, 3000]);
    expect(
      splitAmount(
        1,
        'shares',
        [
          { userId: 'a', value: '0' },
          { userId: 'b', value: '1' },
        ],
        'USD',
      ).map((s) => s.owedAmount),
    ).toEqual([0, 1]);
    expect(() => splitAmount(10000, 'exact', [{ userId: 'a', value: '99.99' }], 'USD')).toThrow(
      '$0.01',
    );
    expect(() => splitAmount(1, 'even', [], 'USD')).toThrow();
    expect(() =>
      splitAmount(
        1,
        'even',
        [
          { userId: 'a', value: '1' },
          { userId: 'a', value: '1' },
        ],
        'USD',
      ),
    ).toThrow();
    expect(() => splitAmount(1, 'shares', [{ userId: 'a', value: '0' }], 'USD')).toThrow();
  });
  it('preserves every cent for randomized totals and weights', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 50 }),
        (total, weights) => {
          const rows = weights.map((weight, i) => ({ userId: `u${i}`, weight: BigInt(weight) }));
          const splits = allocate(total, rows);
          expect(splits.reduce((sum, r) => sum + r.owedAmount, 0)).toBe(total);
          expect(splits.every((s) => Number.isInteger(s.owedAmount) && s.owedAmount >= 0)).toBe(
            true,
          );
          expect(allocate(total, [...rows].reverse())).toEqual(splits);
        },
      ),
      { numRuns: 500 },
    );
  });
});
describe('balances, FX and direct debts', () => {
  it('reproduces the full worked example in the feature specification', () => {
    let state = fixture();
    const specs = [
      { amount: 40000, payer: 'u0', method: 'even' as const, values: ['1', '1', '1', '1'] },
      { amount: 9000, payer: 'u1', method: 'even' as const, values: ['1', '1', '1', '1'] },
      { amount: 6000, payer: 'u2', method: 'shares' as const, values: ['1', '1', '1', '3'] },
      { amount: 20000, payer: 'u3', method: 'exact' as const, values: ['40', '40', '60', '60'] },
    ];
    for (const s of specs)
      state = withEvent(state, {
        kind: 'expense.add',
        expense: expense(state, {
          amount: s.amount,
          payers: [{ userId: s.payer, amountPaid: s.amount }],
          splitMethod: s.method,
          splits: splitAmount(
            s.amount,
            s.method,
            s.values.map((value, i) => ({ userId: `u${i}`, value })),
            'USD',
          ),
        }),
      });
    expect(balances(state).map((b) => b.net)).toEqual([22750, -8250, -13250, -1250]);
    expect(greedy(balances(state))).toEqual([
      { fromUser: 'u2', toUser: 'u0', amount: 13250 },
      { fromUser: 'u1', toUser: 'u0', amount: 8250 },
      { fromUser: 'u3', toUser: 'u0', amount: 1250 },
    ]);
    for (const transfer of settlementPlan(balances(state)).transfers)
      state = withEvent(state, {
        kind: 'settlement.add',
        settlement: {
          ...transfer,
          id: crypto.randomUUID(),
          currency: 'USD',
          method: 'cash',
          note: '',
          createdAt: new Date().toISOString(),
        },
      });
    expect(balances(state).every((b) => b.net === 0)).toBe(true);
  });
  it('converts different currency scales and reconciles each side to the converted total', () => {
    expect(convertedTotal({ amount: 1000, currency: 'JPY', fxRate: '0.0067' }, 'USD')).toBe(670);
    expect(convertedTotal({ amount: 100, currency: 'USD', fxRate: '150' }, 'JPY')).toBe(150);
    const state = fixture(3);
    const e = expense(state, {
      amount: 1,
      currency: 'JPY',
      fxRate: '1.015',
      payers: [{ userId: 'u0', amountPaid: 1 }],
      splits: [
        { userId: 'u0', owedAmount: 1 },
        { userId: 'u1', owedAmount: 0 },
        { userId: 'u2', owedAmount: 0 },
      ],
    });
    const base = baseAmounts(e, 'USD');
    expect(base.total).toBe(102);
    expect(base.payers.reduce((s, p) => s + p.amountPaid, 0)).toBe(102);
    expect(base.splits.reduce((s, p) => s + p.owedAmount, 0)).toBe(102);
  });
  it('preserves net and pairwise invariants across random multi-payer, multi-currency expenses', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            total: fc.integer({ min: 1, max: 1_000_000 }),
            payer: fc.integer({ min: 0, max: 3 }),
            other: fc.integer({ min: 0, max: 3 }),
            fx: fc.integer({ min: 1, max: 20000 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (inputs) => {
          let state = fixture();
          for (const input of inputs) {
            const payers =
              input.payer === input.other
                ? [{ userId: `u${input.payer}`, amountPaid: input.total }]
                : [
                    { userId: `u${input.payer}`, amountPaid: Math.floor(input.total / 2) },
                    { userId: `u${input.other}`, amountPaid: Math.ceil(input.total / 2) },
                  ];
            state = withEvent(state, {
              kind: 'expense.add',
              expense: expense(state, {
                amount: input.total,
                currency: 'EUR',
                fxRate: (input.fx / 1000).toFixed(3),
                payers,
                splits: splitAmount(
                  input.total,
                  'even',
                  state.trip.members.map((m) => ({ userId: m.id, value: '1' })),
                  'EUR',
                ),
              }),
            });
          }
          const nets = balances(state);
          expect(nets.reduce((sum, b) => sum + b.net, 0)).toBe(0);
          const raw = new Map(nets.map((b) => [b.userId, 0]));
          for (const t of pairwise(state)) {
            raw.set(t.fromUser, raw.get(t.fromUser)! - t.amount);
            raw.set(t.toUser, raw.get(t.toUser)! + t.amount);
          }
          expect(nets.map((b) => raw.get(b.userId))).toEqual(nets.map((b) => b.net));
        },
      ),
      { numRuns: 100 },
    );
  });
  it('computes the specified 20-member / 1000-expense workload in under 100 ms', () => {
    const state = fixture(20);
    state.expenses = Array.from({ length: 1000 }, (_, i) => expense(state, { id: `expense-${i}` }));
    balances(state);
    const start = performance.now();
    const net = balances(state);
    const plan = settlementPlan(net);
    const elapsed = performance.now() - start;
    expect(plan.transfers.length).toBeLessThanOrEqual(19);
    expect(elapsed).toBeLessThan(100);
  });
});
describe('minimum transfer plans', () => {
  it('finds a smaller plan when greedy is not optimal', () => {
    const rows = [8, 7, 5, -10, -8, -2].map((net, i) => ({ userId: `u${i}`, net }));
    expect(greedy(rows)).toHaveLength(5);
    expect(settlementPlan(rows).transfers).toHaveLength(4);
    expect(settlementPlan(rows).optimal).toBe(true);
  });
  function bruteMinimum(values: number[]): number {
    const rows = values.filter(Boolean);
    if (!rows.length) return 0;
    let best = Infinity;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] * rows[0] >= 0) continue;
      const next = rows.slice(1);
      next[i - 1] += rows[0];
      best = Math.min(best, 1 + bruteMinimum(next));
    }
    return best;
  }
  it('matches an independent exhaustive optimum and fully settles in the correct direction', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -20, max: 20 }), { minLength: 0, maxLength: 6 }),
        (values) => {
          const input = [...values, -values.reduce((sum, n) => sum + n, 0)].map((net, i) => ({
            userId: `u${i}`,
            net,
          }));
          const plan = settlementPlan(input);
          expect(plan.transfers.length).toBe(bruteMinimum(input.map((r) => r.net)));
          const remaining = new Map(input.map((b) => [b.userId, b.net]));
          for (const t of plan.transfers) {
            expect(input.find((b) => b.userId === t.fromUser)!.net).toBeLessThan(0);
            expect(input.find((b) => b.userId === t.toUser)!.net).toBeGreaterThan(0);
            remaining.set(t.fromUser, remaining.get(t.fromUser)! + t.amount);
            remaining.set(t.toUser, remaining.get(t.toUser)! - t.amount);
          }
          expect([...remaining.values()].every((n) => n === 0)).toBe(true);
          expect(settlementPlan([...input].reverse())).toEqual(plan);
        },
      ),
      { numRuns: 150 },
    );
  });
  it('labels the fallback for large groups and rejects unbalanced input', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      userId: `u${i}`,
      net: i === 0 ? 19 : -1,
    }));
    expect(settlementPlan(rows).optimal).toBe(false);
    expect(settlementPlan(rows).transfers).toHaveLength(19);
    expect(() => settlementPlan([{ userId: 'a', net: 1 }])).toThrow();
  });
});
