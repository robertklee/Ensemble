import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ImagePlus,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { amountInput, balances, CURRENCIES, minor, money, splitAmount } from '../shared/money';
import {
  CATEGORIES,
  METHODS,
  type Expense,
  type ExpensePatch,
  type Ledger,
  type SplitMethod,
  type Transfer,
  type Trip,
  type TripState,
} from '../shared/types';
import { authenticate, cloudAction, dispatch, type Workspace } from './store';
import { exportCSV } from './export';

export function Avatar({
  name,
  size = '',
  index = 0,
}: {
  name: string;
  size?: string;
  index?: number;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <span className={`avatar ${size} color-${index % 6}`} aria-hidden="true" title={name}>
      {initials}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Empty({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="form-error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button className="button primary" type="submit" disabled={busy}>
      {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
      {busy ? 'Saving…' : children}
    </button>
  );
}
export function CurrencySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {CURRENCIES.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit, setError };
}
export function DeleteTripForm({
  state,
  workspace,
  onCancel,
  onDone,
}: {
  state: TripState;
  workspace: Workspace;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const hasBalances = balances(state).some((b) => b.net !== 0);
  const confirmed = confirmation === state.trip.name;
  const { busy, error, submit } = useSubmit(async () => {
    if (!confirmed) throw new Error('Type the trip name exactly to confirm deletion.');
    await dispatch(state.trip.id, { kind: 'trip.delete' });
    onDone();
  });
  return (
    <form className="form" onSubmit={submit}>
      <p>
        Delete <strong>{state.trip.name}</strong>? This removes the trip and its expense and balance
        screens from{' '}
        {workspace.mode === 'cloud' ? "every member's trip list" : 'this local workspace'}. There is
        no undo in the app.
      </p>
      {hasBalances && (
        <div className="deletion-warning">
          This trip still has outstanding balances. Deleting it does not settle or forgive those
          debts. Export a copy first if you need to keep track of them.
        </div>
      )}
      <button type="button" className="button secondary" onClick={() => exportCSV(state)}>
        <Download size={16} /> Export CSV before deleting
      </button>
      <label>
        Type the trip name to confirm
        <input
          autoFocus
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={busy}
          placeholder={state.trip.name}
        />
      </label>
      <p className="footnote">
        Financial history is retained for audit and in JSON backups; this is not a permanent data
        erasure. {workspace.mode === 'cloud' && 'If offline, deletion syncs when you reconnect.'}
      </p>
      <ErrorText error={error} />
      <div className="form-footer">
        <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button destructive" disabled={busy || !confirmed}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
          {busy ? 'Deleting…' : 'Delete trip'}
        </button>
      </div>
    </form>
  );
}
export function TripForm({
  workspace,
  onDone,
}: {
  workspace: Workspace;
  onDone: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [description, setDescription] = useState('');
  const [currency, setCurrency] = useState(workspace.user.defaultCurrency);
  const [startDate, setStartDate] = useState(''),
    [endDate, setEndDate] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const trip: Trip = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      baseCurrency: currency,
      startDate,
      endDate,
      status: 'active',
      createdBy: workspace.user.id,
      createdAt: new Date().toISOString(),
      members: [
        {
          id: workspace.user.id,
          name: workspace.user.displayName,
          role: 'organizer',
          isGhost: false,
        },
      ],
    };
    await dispatch(trip.id, { kind: 'trip.create', trip });
    onDone(trip.id);
  });
  return (
    <form onSubmit={submit} className="form">
      <label>
        Trip name
        <input
          autoFocus
          required
          maxLength={80}
          placeholder="e.g. A weekend in the mountains"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        A little about the trip <span className="optional">optional</span>
        <textarea
          maxLength={1000}
          rows={2}
          placeholder="What's the adventure?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          Start date
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          End date
          <input
            type="date"
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>
      <label>
        Settle in
        <CurrencySelect value={currency} onChange={setCurrency} />
      </label>
      <div className="info-box">
        All balances and payments use this currency. You can still add expenses in other currencies.
      </div>
      <ErrorText error={error} />
      <div className="form-footer">
        <span>Good trips start here.</span>
        <Submit busy={busy}>Create trip</Submit>
      </div>
    </form>
  );
}
async function receiptImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15_000_000)
    throw new Error('Choose a JPEG, PNG or WebP image under 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is not available in this browser.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.4, 0.2]) {
      const result = canvas.toDataURL('image/jpeg', quality);
      if (result.length <= 245_000) return result;
    }
    throw new Error('This receipt is too detailed to store. Crop or resize it and try again.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function ExpenseForm({
  state,
  workspace,
  initial,
  onDone,
}: {
  state: TripState;
  workspace: Workspace;
  initial?: Expense;
  onDone: () => void;
}) {
  const [baseline] = useState(() =>
    initial ? state.expenses.find((e) => e.id === initial.id) : undefined,
  );
  const members = state.trip.members.filter(
    (m) =>
      !m.left ||
      baseline?.payers.some((p) => p.userId === m.id) ||
      baseline?.splits.some((s) => s.userId === m.id),
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(
    initial ? amountInput(initial.amount, initial.currency) : '',
  );
  const [currency, setCurrency] = useState(initial?.currency ?? state.trip.baseCurrency);
  const [rate, setRate] = useState(initial?.fxRate ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toLocaleDateString('en-CA'));
  const [category, setCategory] = useState<Expense['category']>(initial?.category ?? 'food');
  const [method, setMethod] = useState<SplitMethod>(initial?.splitMethod ?? 'even');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [attachments, setAttachments] = useState(initial?.attachments ?? []);
  const [uploading, setUploading] = useState(false);
  const [payerIds, setPayerIds] = useState(
    initial?.payers.map((p) => p.userId) ?? [workspace.user.id],
  );
  const [payerValues, setPayerValues] = useState<Record<string, string>>(
    Object.fromEntries(
      initial?.payers.map((p) => [p.userId, amountInput(p.amountPaid, initial.currency)]) ?? [],
    ),
  );
  const [selected, setSelected] = useState(
    initial?.splits.map((s) => s.userId) ?? members.map((m) => m.id),
  );
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      members.map((m) => {
        const old = initial?.splits.find((s) => s.userId === m.id);
        return [
          m.id,
          method === 'exact' && old && initial
            ? amountInput(old.owedAmount, initial.currency)
            : (old?.shareWeight ?? '1'),
        ];
      }),
    ),
  );
  let preview: ReturnType<typeof splitAmount> = [],
    previewError = '';
  try {
    if (amount)
      preview = splitAmount(
        minor(amount, currency),
        method,
        selected.map((userId) => ({ userId, value: values[userId] || '0' })),
        currency,
      );
  } catch (error) {
    previewError = error instanceof Error ? error.message : 'Check the split.';
  }
  const { busy, error, submit, setError } = useSubmit(async () => {
    if (uploading) throw new Error('Wait for receipt processing to finish.');
    const total = minor(amount, currency);
    const splits = splitAmount(
      total,
      method,
      selected.map((userId) => ({ userId, value: values[userId] || '0' })),
      currency,
    );
    const ledger: Ledger = {
      amount: total,
      currency,
      fxRate: currency === state.trip.baseCurrency ? '1' : rate,
      payers: payerIds.map((userId) => ({
        userId,
        amountPaid: payerIds.length === 1 ? total : minor(payerValues[userId] || '0', currency),
      })),
      splitMethod: method,
      splits,
    };
    const fields = {
      description: description.trim(),
      category,
      date,
      notes: notes.trim(),
      attachments,
    };
    if (baseline) {
      const patch: ExpensePatch = {};
      if (fields.description !== baseline.description) patch.description = fields.description;
      if (fields.category !== baseline.category) patch.category = fields.category;
      if (fields.date !== baseline.date) patch.date = fields.date;
      if (fields.notes !== baseline.notes) patch.notes = fields.notes;
      if (JSON.stringify(fields.attachments) !== JSON.stringify(baseline.attachments))
        patch.attachments = fields.attachments;
      const oldLedger: Ledger = {
        amount: baseline.amount,
        currency: baseline.currency,
        fxRate: baseline.fxRate,
        payers: baseline.payers,
        splitMethod: baseline.splitMethod,
        splits: baseline.splits,
      };
      if (JSON.stringify(ledger) !== JSON.stringify(oldLedger)) patch.ledger = ledger;
      if (Object.keys(patch).length)
        await dispatch(state.trip.id, { kind: 'expense.edit', expenseId: baseline.id, patch });
    } else {
      const now = new Date().toISOString();
      await dispatch(state.trip.id, {
        kind: 'expense.add',
        expense: {
          id: crypto.randomUUID(),
          ...fields,
          ...ledger,
          createdBy: workspace.user.id,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    onDone();
  });
  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
  const changeMethod = (next: SplitMethod) => {
    setMethod(next);
    setValues(
      Object.fromEntries(
        members.map((m) => [
          m.id,
          next === 'exact'
            ? amountInput(preview.find((s) => s.userId === m.id)?.owedAmount ?? 0, currency)
            : '1',
        ]),
      ),
    );
  };
  return (
    <form className="form expense-form" onSubmit={submit}>
      <label>
        What was it for?
        <input
          autoFocus
          required
          maxLength={160}
          placeholder="Dinner, a place to stay, a little adventure…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="form-row amount-row">
        <label>
          Amount
          <input
            className="amount-input"
            inputMode="decimal"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Currency
          <CurrencySelect value={currency} onChange={setCurrency} />
        </label>
      </div>
      {currency !== state.trip.baseCurrency && (
        <label>
          Exchange rate · 1 {currency} in {state.trip.baseCurrency}
          <input
            inputMode="decimal"
            required
            placeholder="e.g. 0.92"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <small>
            Enter the rate from your receipt or card statement. This rate is saved with the expense.
          </small>
        </label>
      )}
      <div className="form-row">
        <label>
          Date
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Expense['category'])}
          >
            {CATEGORIES.map((c) => (
              <option value={c} key={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>
          Paid by <span className="optional">select one or more</span>
        </legend>
        <div className="member-chips">
          {members.map((m, i) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={payerIds.includes(m.id)}
              className={`member-chip ${payerIds.includes(m.id) ? 'selected' : ''}`}
              onClick={() => setPayerIds(toggle(payerIds, m.id))}
            >
              <Avatar name={m.name} size="tiny" index={i} />
              {m.id === workspace.user.id ? 'You' : m.name}
              {payerIds.includes(m.id) && <Check size={14} />}
            </button>
          ))}
        </div>
        {payerIds.length > 1 && (
          <div className="payer-amounts">
            {payerIds.map((id) => (
              <label key={id}>
                {members.find((m) => m.id === id)?.name} paid
                <input
                  aria-label={`${members.find((m) => m.id === id)?.name} paid`}
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  value={payerValues[id] ?? ''}
                  onChange={(e) => setPayerValues({ ...payerValues, [id]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend>How should we split it?</legend>
        <div className="segmented">
          {(['even', 'shares', 'exact'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              className={method === m ? 'selected' : ''}
              onClick={() => changeMethod(m)}
            >
              {m === 'even' ? 'Equally' : m === 'shares' ? 'By shares' : 'Exact amounts'}
            </button>
          ))}
        </div>
        <div className="split-list">
          {members.map((m, i) => (
            <div className="split-person" key={m.id}>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={() => setSelected(toggle(selected, m.id))}
                />
                <Avatar name={m.name} size="tiny" index={i} />
                <span>{m.id === workspace.user.id ? `${m.name} (you)` : m.name}</span>
              </label>
              {method !== 'even' && selected.includes(m.id) && (
                <input
                  className="split-value"
                  aria-label={`${m.name} ${method === 'shares' ? 'shares' : 'exact amount'}`}
                  inputMode="decimal"
                  required
                  value={values[m.id] ?? ''}
                  onChange={(e) => setValues({ ...values, [m.id]: e.target.value })}
                />
              )}
              <span className="split-preview">
                {money(preview.find((s) => s.userId === m.id)?.owedAmount ?? 0, currency)}
              </span>
            </div>
          ))}
        </div>
        {previewError ? (
          <p className="split-hint warning">{previewError}</p>
        ) : (
          <p className="split-hint">
            <CheckCircle2 size={14} />
            {selected.length} {selected.length === 1 ? 'person' : 'people'} · every cent accounted
            for
          </p>
        )}
      </fieldset>
      <label>
        Notes <span className="optional">optional</span>
        <textarea
          rows={2}
          maxLength={2000}
          placeholder="Anything the group should know?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="receipt-row">
        {attachments.map((a, i) => (
          <div className="receipt-thumb" key={i}>
            <img src={a} alt={`Receipt ${i + 1}`} />
            <button
              type="button"
              aria-label={`Remove receipt ${i + 1}`}
              onClick={() => setAttachments(attachments.filter((_, index) => index !== i))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {attachments.length < 3 && (
          <label className={`upload-button ${uploading ? 'disabled' : ''}`}>
            <ImagePlus size={19} />
            {uploading ? 'Processing…' : 'Add receipt'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploading(true);
                void receiptImage(file)
                  .then((data) => setAttachments((old) => [...old, data]))
                  .catch((error: unknown) =>
                    setError(error instanceof Error ? error.message : 'Could not read this image.'),
                  )
                  .finally(() => setUploading(false));
              }}
            />
          </label>
        )}
      </div>
      <ErrorText error={error} />
      <div className="form-footer">
        <span>
          {workspace.mode === 'local'
            ? 'Saved on this device'
            : 'Works offline, syncs when connected'}
        </span>
        <Submit busy={busy || uploading}>{initial ? 'Save changes' : 'Add expense'}</Submit>
      </div>
    </form>
  );
}
export function PaymentForm({
  state,
  transfer,
  onDone,
}: {
  state: TripState;
  transfer?: Transfer;
  onDone: () => void;
}) {
  const members = state.trip.members.filter((m) => !m.left);
  const [from, setFrom] = useState(transfer?.fromUser ?? members[0]?.id ?? '');
  const [to, setTo] = useState(transfer?.toUser ?? members[1]?.id ?? '');
  const [amount, setAmount] = useState(
    transfer ? amountInput(transfer.amount, state.trip.baseCurrency) : '',
  );
  const [method, setMethod] = useState<(typeof METHODS)[number]>('bank_transfer');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    if (!confirmed) throw new Error('Confirm that this payment has already happened.');
    await dispatch(state.trip.id, {
      kind: 'settlement.add',
      settlement: {
        id: crypto.randomUUID(),
        fromUser: from,
        toUser: to,
        amount: minor(amount, state.trip.baseCurrency),
        currency: state.trip.baseCurrency,
        method,
        note: note.trim(),
        createdAt: new Date().toISOString(),
      },
    });
    onDone();
  });
  return (
    <form className="form" onSubmit={submit}>
      <div className="info-box">
        This records a payment made outside Ensemble. No money will be moved.
      </div>
      <div className="form-row">
        <label>
          Who paid?
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Who received it?
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Amount · {state.trip.baseCurrency}
        <input
          autoFocus
          required
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        Paid with
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note <span className="optional">optional</span>
        <input
          maxLength={1000}
          placeholder="e.g. Sent on Tuesday"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        This payment has already been made.
      </label>
      <ErrorText error={error} />
      <div className="form-footer">
        <span>Partial payments are welcome.</span>
        <Submit busy={busy}>Record payment</Submit>
      </div>
    </form>
  );
}
export function AuthForm({
  onDone,
  existingUsername,
}: {
  onDone: () => void;
  existingUsername?: string;
}) {
  const [kind, setKind] = useState<'login' | 'signup'>(existingUsername ? 'login' : 'signup');
  const [username, setUsername] = useState(existingUsername ?? ''),
    [password, setPassword] = useState(''),
    [displayName, setDisplayName] = useState(''),
    [currency, setCurrency] = useState('USD');
  const { busy, error, submit } = useSubmit(async () => {
    await authenticate(kind, { username, password, displayName, currency });
    onDone();
  });
  return (
    <form className="form" onSubmit={submit}>
      <div className="segmented">
        <button
          className={kind === 'signup' ? 'selected' : ''}
          type="button"
          onClick={() => setKind('signup')}
        >
          Create account
        </button>
        <button
          className={kind === 'login' ? 'selected' : ''}
          type="button"
          onClick={() => setKind('login')}
        >
          Sign in
        </button>
      </div>
      {kind === 'signup' && (
        <label>
          Your name
          <input
            autoFocus
            required
            autoComplete="name"
            maxLength={60}
            placeholder="How friends know you"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      )}
      <label>
        Username
        <input
          aria-label="Username"
          aria-describedby="username-hint"
          required
          autoComplete="username"
          minLength={3}
          maxLength={30}
          pattern="[a-zA-Z0-9_]+"
          placeholder="e.g. alex_travels"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <small id="username-hint">Friends can find you by this exact username.</small>
      </label>
      <label>
        Password
        <input
          required
          type="password"
          autoComplete={kind === 'signup' ? 'new-password' : 'current-password'}
          minLength={12}
          maxLength={200}
          placeholder="At least 12 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {kind === 'signup' && (
        <>
          <label>
            Default currency
            <CurrencySelect value={currency} onChange={setCurrency} />
          </label>
          <div className="info-box">
            Save your password in a password manager. Password recovery is not available in this
            version. Local trips stay separate from your shared account.
          </div>
        </>
      )}
      <ErrorText error={error} />
      <div className="form-footer">
        <span>No ads. No subscription.</span>
        <Submit busy={busy}>{kind === 'signup' ? 'Create account' : 'Sign in'}</Submit>
      </div>
    </form>
  );
}
export function InvitePanel({
  state,
  workspace,
  onDone,
  onAuth,
}: {
  state: TripState;
  workspace: Workspace;
  onDone: () => void;
  onAuth: () => void;
}) {
  const [name, setName] = useState(''),
    [link, setLink] = useState(''),
    [copied, setCopied] = useState(false),
    [makeFriends, setMakeFriends] = useState(true);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not invite this person.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <h3>Add a friend without an account</h3>
      <p className="muted">Track their share now. Merge their placeholder into an account later.</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            await dispatch(state.trip.id, {
              kind: 'member.add',
              member: { id: crypto.randomUUID(), name: name.trim(), isGhost: true, role: 'member' },
            });
            onDone();
          });
        }}
      >
        <input
          required
          autoFocus
          maxLength={60}
          aria-label="Friend's name"
          placeholder="Friend's name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="button primary" disabled={busy}>
          <Plus size={17} />
          Add
        </button>
      </form>
      <div className="divider" />
      {workspace.mode === 'local' ? (
        <div className="local-invite">
          <h3>Bring everyone along</h3>
          <p>
            Sign in to create shared trips and invite friends. This local trip stays on your device
            and isn't shared.
          </p>
          <button className="button secondary" onClick={onAuth}>
            Create a shared account
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <>
          <h3>Invite with a link</h3>
          <p className="muted">
            Anyone with the link and an account can join. Links expire after 7 days.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={makeFriends}
              onChange={(e) => {
                setMakeFriends(e.target.checked);
                setLink('');
              }}
            />
            Also connect new members as my friends
          </label>
          {link ? (
            <div className="inline-form">
              <input
                readOnly
                aria-label="Invite link"
                value={link}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="button secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        'Clipboard access is unavailable. Select and copy the link manually.',
                      ),
                    );
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await cloudAction(`trips/${state.trip.id}/invite`, 'POST', {
                    makeFriends,
                  });
                  setLink(result.url);
                })
              }
            >
              Create invite link
            </button>
          )}
          {workspace.friends
            .filter(
              (f) =>
                f.status === 'accepted' &&
                !state.trip.members.some((m) => m.id === f.user.id && !m.left),
            )
            .map((f) => (
              <div key={f.id} className="friend-invite-row">
                <Avatar name={f.user.displayName} />
                <span>{f.user.displayName}</span>
                <button
                  className="button small secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await cloudAction(`trips/${state.trip.id}/invite`, 'POST', {
                        friendId: f.user.id,
                      });
                    })
                  }
                >
                  <Plus size={14} />
                  Invite
                </button>
              </div>
            ))}
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
