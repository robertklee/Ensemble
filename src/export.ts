import { balances, money, settlementPlan } from '../shared/money';
import type { TripState, User } from '../shared/types';
import type { Workspace } from './store';
import { serializeBackup, serializeTrip } from './backup';

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = (name: string) => name.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-');
function cell(value: string | number) {
  const text = String(value);
  return `"${(typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
}
export function exportCSV(state: TripState) {
  const name = (id: string) => state.trip.members.find((m) => m.id === id)?.name ?? id;
  const rows: (string | number)[][] = [
    [
      'Record',
      'Date',
      'Description',
      'From / member',
      'To',
      'Amount (minor units)',
      'Currency',
      'Detail',
    ],
  ];
  for (const e of state.expenses.filter((e) => !e.deletedAt)) {
    rows.push([
      'Expense',
      e.date,
      e.description,
      '',
      '',
      e.amount,
      e.currency,
      `${e.category}; ${e.splitMethod}; FX ${e.fxRate}`,
    ]);
    for (const p of e.payers)
      rows.push([
        'Payer',
        e.date,
        e.description,
        name(p.userId),
        '',
        p.amountPaid,
        e.currency,
        e.notes,
      ]);
    for (const s of e.splits)
      rows.push([
        'Split',
        e.date,
        e.description,
        name(s.userId),
        '',
        s.owedAmount,
        e.currency,
        s.shareWeight ?? '',
      ]);
  }
  const nets = balances(state);
  for (const b of nets) {
    rows.push([
      'Total paid',
      '',
      '',
      name(b.userId),
      '',
      b.paid,
      state.trip.baseCurrency,
      'Expenses only',
    ]);
    rows.push([
      'Total owed',
      '',
      '',
      name(b.userId),
      '',
      b.owed,
      state.trip.baseCurrency,
      'Expenses only',
    ]);
    rows.push([
      'Net balance',
      '',
      '',
      name(b.userId),
      '',
      b.net,
      state.trip.baseCurrency,
      'Includes settlements',
    ]);
  }
  for (const s of state.settlements)
    rows.push([
      'Payment',
      s.createdAt,
      s.note,
      name(s.fromUser),
      name(s.toUser),
      s.amount,
      s.currency,
      s.method,
    ]);
  for (const t of settlementPlan(nets).transfers)
    rows.push([
      'Suggested transfer',
      '',
      '',
      name(t.fromUser),
      name(t.toUser),
      t.amount,
      state.trip.baseCurrency,
      'Not yet paid',
    ]);
  download(
    '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n'),
    `${slug(state.trip.name)}.csv`,
    'text/csv;charset=utf-8',
  );
}
const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export function printTrip(state: TripState) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow pop-ups to open the printable trip summary.');
  win.opener = null;
  const name = (id: string) => escape(state.trip.members.find((m) => m.id === id)?.name ?? id);
  const nets = balances(state);
  const currency = state.trip.baseCurrency;
  const plan = settlementPlan(nets);
  win.document
    .write(`<!doctype html><html><head><title>${escape(state.trip.name)} — Ensemble</title><style>body{font:14px system-ui;color:#182e25;margin:40px}h1{font-size:32px}h2{margin-top:32px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px 6px;border-bottom:1px solid #ddd}th{font-size:12px;color:#555}small{color:#555}@media print{body{margin:0}tr{break-inside:avoid}}</style></head><body>
  <small>ENSEMBLE · TRIP SUMMARY</small><h1>${escape(state.trip.name)}</h1><p>${escape(state.trip.description)}</p><p>${escape(state.trip.startDate)} – ${escape(state.trip.endDate)} · ${currency}</p>
  <h2>Member totals</h2><table><thead><tr><th>Member</th><th>Paid</th><th>Share</th><th>Net (with payments)</th></tr></thead><tbody>${nets.map((b) => `<tr><td>${name(b.userId)}</td><td>${money(b.paid, currency)}</td><td>${money(b.owed, currency)}</td><td>${money(b.net, currency)}</td></tr>`).join('')}</tbody></table>
  <h2>Expenses</h2><table><thead><tr><th>Date</th><th>Expense</th><th>Paid by</th><th>Amount</th></tr></thead><tbody>${state.expenses
    .filter((e) => !e.deletedAt)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      (e) =>
        `<tr><td>${escape(e.date)}</td><td>${escape(e.description)}</td><td>${e.payers.map((p) => `${name(p.userId)} (${money(p.amountPaid, e.currency)})`).join(', ')}</td><td>${money(e.amount, e.currency)}${e.currency !== currency ? ` <small>FX ${escape(e.fxRate)}</small>` : ''}</td></tr>`,
    )
    .join('')}</tbody></table>
  <h2>Recorded payments</h2>${state.settlements.length ? state.settlements.map((s) => `<p>${name(s.fromUser)} → ${name(s.toUser)}: ${money(s.amount, currency)} · ${escape(s.method.replace('_', ' '))} · ${escape(s.createdAt.slice(0, 10))}</p>`).join('') : '<p>No payments recorded.</p>'}
  <h2>${plan.optimal ? 'Minimum-transfer' : 'Simplified'} settlement plan</h2>${plan.transfers.length ? plan.transfers.map((t) => `<p>${name(t.fromUser)} → ${name(t.toUser)}: <strong>${money(t.amount, currency)}</strong></p>`).join('') : '<p>All settled up.</p>'}
  <small>Generated ${escape(new Date().toLocaleString())}. Suggested transfers are not recorded payments.</small></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
export function exportBackup(workspace: Workspace) {
  download(serializeBackup(workspace), 'ensemble-backup.json', 'application/json');
}
export function exportTripJSON(state: TripState, user: User) {
  download(serializeTrip(state, user), `${slug(state.trip.name)}.json`, 'application/json');
}
