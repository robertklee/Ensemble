import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudOff,
  Compass,
  Download,
  FileText,
  Globe2,
  Heart,
  History,
  Home,
  Leaf,
  Link2,
  LoaderCircle,
  LogOut,
  Map,
  Menu,
  MessageCircle,
  Pencil,
  Plane,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  Utensils,
  Wallet,
  WifiOff,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { eventLabel, project } from '../shared/events';
import {
  balances,
  baseAmounts,
  expenseTransfers,
  money,
  pairwise,
  settlementPlan,
} from '../shared/money';
import {
  CATEGORIES,
  type Category,
  type Expense,
  type Transfer,
  type TripState,
} from '../shared/types';
import {
  AuthForm,
  Avatar,
  DeleteTripForm,
  Empty,
  ErrorText,
  ExpenseForm,
  InvitePanel,
  ImportBackupForm,
  ImportTripForm,
  LocalProfileForm,
  Modal,
  PaymentForm,
  TripForm,
} from './components';
import { exportBackup, exportCSV, exportTripJSON, printTrip } from './export';
import {
  clearError,
  cloudAction,
  discardPending,
  dispatch,
  initialize,
  logout,
  showError,
  sync,
  tripStates,
  tripMemberId,
  useWorkspace,
  type Workspace,
} from './store';

const categoryIcons: Record<Category, LucideIcon> = {
  food: Utensils,
  lodging: Home,
  transport: Plane,
  activity: Compass,
  shopping: ShoppingBag,
  other: Receipt,
};
type Tab = 'expenses' | 'balances' | 'settle' | 'activity' | 'members';
type ModalState =
  | {
      kind:
        | 'trip'
        | 'delete-trip'
        | 'edit-trip'
        | 'auth'
        | 'invite'
        | 'export'
        | 'import'
        | 'import-trip'
        | 'profile'
        | 'notices'
        | 'help'
        | 'join';
    }
  | { kind: 'expense'; initial?: Expense }
  | { kind: 'detail'; id: string }
  | { kind: 'payment'; transfer?: Transfer }
  | { kind: 'merge'; ghostId: string };
const humanDate = (
  date: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
) => new Date(date.length === 10 ? date + 'T12:00:00' : date).toLocaleDateString('en', options);
const memberName = (state: TripState, id: string) =>
  state.trip.members.find((m) => m.id === id)?.name ?? 'Former member';
function Scene({ small = false }: { small?: boolean }) {
  return (
    <div className={`scene ${small ? 'scene-small' : ''}`} aria-hidden="true">
      <div className="scene-sun" />
      <div className="scene-cloud one" />
      <div className="scene-cloud two" />
      <div className="hill back" />
      <div className="hill front" />
      <div className="sea" />
      <div className="house house-one">
        <i />
        <b />
      </div>
      <div className="house house-two">
        <i />
        <b />
      </div>
      <div className="house house-three">
        <i />
        <b />
      </div>
      <div className="tree tree-one" />
      <div className="tree tree-two" />
      <div className="boat" />
    </div>
  );
}
export default function App() {
  const { workspace, loading, syncing, online, error } = useWorkspace();
  const [selected, setSelected] = useState<string | null>('sample-lisbon');
  const [page, setPage] = useState<'trips' | 'friends'>('trips');
  const [tab, setTab] = useState<Tab>('expenses');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [member, setMember] = useState('');
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [filters, setFilters] = useState(false),
    [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState('');
  const [optimal, setOptimal] = useState(true);
  const [busy, setBusy] = useState(false);
  const states = useMemo(() => (workspace ? tripStates(workspace) : []), [workspace]);
  const state = states.find((s) => s.trip.id === selected);
  const nets = useMemo(() => (state ? balances(state) : []), [state]);
  const plan = useMemo(() => settlementPlan(nets, optimal), [nets, optimal]);
  const raw = useMemo(() => (state ? pairwise(state) : []), [state]);
  const joinToken = new URLSearchParams(location.search).get('join');
  useEffect(() => {
    void initialize();
    if (joinToken) setModal({ kind: 'join' });
  }, [joinToken]);
  useEffect(() => {
    const deletion = workspace?.events.find(
      (e) => e.tripId === selected && e.kind === 'trip.delete',
    );
    if (!deletion) return;
    setSelected(null);
    setModal((current) =>
      current &&
      [
        'expense',
        'detail',
        'payment',
        'invite',
        'export',
        'merge',
        'delete-trip',
        'edit-trip',
      ].includes(current.kind)
        ? null
        : current,
    );
    if (workspace && deletion.actor !== tripMemberId(workspace, deletion.tripId))
      setMessage('This trip was deleted by its organizer.');
  }, [workspace, selected]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    setSearch('');
    setCategory('');
    setMember('');
    setStart('');
    setEnd('');
    setDeleted(false);
    setTab('expenses');
  }, [selected]);
  const close = () => setModal(null);
  const done = (text: string) => {
    close();
    setMessage(text);
  };
  async function run(action: () => Promise<void>, success?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (success) setMessage(success);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string | null) {
    setSelected(id);
    setPage('trips');
    setNavOpen(false);
  }
  if (loading)
    return (
      <div className="loading-screen">
        <img src="/ensemble-icon.svg" alt="" />
        <h1>Ensemble</h1>
        <LoaderCircle className="spin" />
        <p>Making room for your next adventure.</p>
      </div>
    );
  if (!workspace)
    return (
      <div className="fatal">
        <h1>Your browser storage isn't ready.</h1>
        <p role="alert">{error}</p>
        <button className="button primary" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  const currency = state?.trip.baseCurrency ?? workspace.user.defaultCurrency;
  const activeMember = state?.trip.members.find(
    (m) => m.id === tripMemberId(workspace, state.trip.id),
  );
  const tripWorkspace: Workspace =
    workspace.mode === 'local' &&
    state &&
    workspace.localTripMembers?.[state.trip.id] &&
    activeMember
      ? {
          ...workspace,
          user: { ...workspace.user, id: activeMember.id, displayName: activeMember.name },
        }
      : workspace;
  const expenses = state?.expenses.filter((e) => !e.deletedAt) ?? [];
  const total = nets.reduce((sum, b) => sum + b.paid, 0);
  const you = nets.find((b) => b.userId === tripWorkspace.user.id);
  const currentMembers = state?.trip.members.filter((m) => !m.left) ?? [];
  const organizer = state?.trip.createdBy === tripWorkspace.user.id;
  const closed = state?.trip.status === 'closed';
  const filteredExpenses = (state?.expenses ?? [])
    .filter(
      (e) =>
        (deleted || !e.deletedAt) &&
        (!search || `${e.description} ${e.notes}`.toLowerCase().includes(search.toLowerCase())) &&
        (!category || e.category === category) &&
        (!member ||
          e.payers.some((p) => p.userId === member) ||
          e.splits.some((s) => s.userId === member)) &&
        (!start || e.date >= start) &&
        (!end || e.date <= end),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const filteredPayments = (state?.settlements ?? []).filter(
    (s) =>
      !category &&
      (!member || s.fromUser === member || s.toUser === member) &&
      (!start || s.createdAt.slice(0, 10) >= start) &&
      (!end || s.createdAt.slice(0, 10) <= end) &&
      (!search ||
        `payment ${s.note} ${memberName(state!, s.fromUser)} ${memberName(state!, s.toUser)}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const historyItems = [
    ...filteredExpenses.map((e) => ({
      type: 'expense' as const,
      date: e.date,
      id: e.id,
      expense: e,
    })),
    ...filteredPayments.map((s) => ({
      type: 'payment' as const,
      date: s.createdAt.slice(0, 10),
      id: s.id,
      payment: s,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const filterBar = (
    <>
      <div className="filter-bar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Search expenses"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses…"
          />
          {search && (
            <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}>
              <X size={15} />
            </button>
          )}
        </div>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        <button
          aria-label="Filters"
          className={`button secondary filter-toggle ${filters ? 'active' : ''}`}
          onClick={() => setFilters(!filters)}
          aria-expanded={filters}
        >
          <SlidersHorizontal size={16} />
          <span>Filters</span>
          {(member || start || end || deleted) && <i className="dot" />}
        </button>
      </div>
      {filters && (
        <div className="expanded-filters">
          <label>
            Member
            <select value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">Everyone</option>
              {state?.trip.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Through
            <input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={deleted}
              onChange={(e) => setDeleted(e.target.checked)}
            />
            Show deleted
          </label>
          <button
            className="text-button"
            onClick={() => {
              setMember('');
              setStart('');
              setEnd('');
              setDeleted(false);
              setSearch('');
              setCategory('');
            }}
          >
            Reset
          </button>
        </div>
      )}
    </>
  );
  return (
    <div className="app-shell">
      {navOpen && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            choose(null);
          }}
        >
          <img src="/ensemble-icon.svg" alt="" />
          <span>
            ensemble<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="brand-tagline">Good trips. No loose ends.</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${page === 'trips' ? 'active' : ''}`}
            onClick={() => choose(null)}
          >
            <Map size={19} />
            My trips<span className="nav-count">{states.length}</span>
          </button>
          <button
            className={`nav-item ${page === 'friends' ? 'active' : ''}`}
            onClick={() => {
              setPage('friends');
              setNavOpen(false);
            }}
          >
            <Users size={19} />
            Friends
            {workspace.friends.some((f) => f.incoming && f.status === 'pending') && (
              <i className="dot" />
            )}
          </button>
        </nav>
        <div className="sidebar-section-title">
          YOUR TRIPS
          <button
            className="icon-button"
            aria-label="Create a trip"
            onClick={() => setModal({ kind: 'trip' })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="sidebar-trips">
          {states.map((s, i) => (
            <button
              key={s.trip.id}
              className={`trip-nav ${selected === s.trip.id && page === 'trips' ? 'selected' : ''}`}
              onClick={() => choose(s.trip.id)}
            >
              <span className={`trip-nav-icon color-${i % 6}`}>
                <Compass size={16} />
              </span>
              <span>{s.trip.name}</span>
              {s.trip.status === 'closed' && <Check size={13} />}
            </button>
          ))}
        </div>
        <button className="new-trip-link" onClick={() => setModal({ kind: 'trip' })}>
          <Plus size={16} />
          Create a new trip
        </button>
        <button className="new-trip-link" onClick={() => setModal({ kind: 'import-trip' })}>
          <Upload size={16} />
          Import trip JSON
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="little-spark">
              <Sparkles size={20} />
            </span>
            <strong>
              More memories.
              <br />
              Less money math.
            </strong>
            <p>
              We'll take care of the split.
              <br />
              You enjoy the trip.
            </p>
          </div>
          <button className="nav-item subtle" onClick={() => setModal({ kind: 'help' })}>
            <CircleHelp size={18} />
            How Ensemble works
            <ArrowUpRight size={14} />
          </button>
          <button className="profile-button" onClick={() => setModal({ kind: 'profile' })}>
            <Avatar name={workspace.user.displayName} />
            <span>
              <strong>{workspace.user.displayName}</strong>
              <small>
                {workspace.mode === 'local' ? 'Local workspace' : `@${workspace.user.username}`}
              </small>
            </span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={22} />
            </button>
            <button onClick={() => choose(null)}>My trips</button>
            {state && page === 'trips' && (
              <>
                <ChevronRight size={14} />
                <span>{state.trip.name}</span>
              </>
            )}
            {page === 'friends' && (
              <>
                <ChevronRight size={14} />
                <span>Friends</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className={`sync-status ${!online ? 'offline' : ''}`}
              onClick={() =>
                workspace.mode === 'local' ? setModal({ kind: 'profile' }) : void run(sync)
              }
              title={
                workspace.mode === 'local' ? 'Trips are stored only in this browser' : 'Sync now'
              }
            >
              {!online ? (
                <WifiOff size={14} />
              ) : syncing ? (
                <LoaderCircle size={14} className="spin" />
              ) : workspace.mode === 'local' ? (
                <CloudOff size={14} />
              ) : (
                <Cloud size={14} />
              )}
              <span>
                {!online
                  ? 'Offline · saved here'
                  : syncing
                    ? 'Syncing'
                    : workspace.mode === 'local'
                      ? 'On this device'
                      : workspace.pending.length
                        ? `${workspace.pending.length} pending`
                        : 'All changes saved'}
              </span>
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => setModal({ kind: 'notices' })}
            >
              <Bell size={19} />
              {workspace.notices.some((n) => !n.read) && <i className="dot" />}
            </button>
            <button
              className="avatar-button"
              aria-label="Your account"
              onClick={() => setModal({ kind: 'profile' })}
            >
              <Avatar name={workspace.user.displayName} size="small" />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            {workspace.pending.length > 0 && (
              <button onClick={() => setModal({ kind: 'profile' })}>Review pending changes</button>
            )}
            <button className="icon-button" onClick={clearError} aria-label="Dismiss error">
              <X size={17} />
            </button>
          </div>
        )}
        <main id="main" className="main-content">
          {page === 'friends' ? (
            <FriendsPage workspace={workspace} onAuth={() => setModal({ kind: 'auth' })} />
          ) : !state ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A LITTLE LESS MATH, A LOT MORE ADVENTURE</div>
                  <h1>Good times. Fair shares.</h1>
                  <p>Your people, your places, all squared away.</p>
                </div>
                <button className="button primary" onClick={() => setModal({ kind: 'trip' })}>
                  <Plus size={18} />
                  Create a trip
                </button>
              </div>
              <div className="home-hero">
                <div>
                  <span className="pill">
                    <Leaf size={13} />
                    Made for going places
                  </span>
                  <h2>
                    The best things in life
                    <br />
                    are better shared.
                  </h2>
                  <p>Keep track of the little things, so you can focus on the big adventure.</p>
                  <button className="button primary" onClick={() => setModal({ kind: 'trip' })}>
                    Plan your next trip
                    <ArrowRight size={17} />
                  </button>
                </div>
                <Scene />
              </div>
              <div className="section-heading">
                <h2>
                  Your trips <span className="count-badge">{states.length}</span>
                </h2>
                <span className="muted">A place for every adventure</span>
              </div>
              {states.length ? (
                <div className="trip-grid">
                  {states.map((s, i) => (
                    <button className="trip-card" key={s.trip.id} onClick={() => choose(s.trip.id)}>
                      <div className={`trip-card-art art-${i % 3}`}>
                        <Scene small />
                        <span className={`status-pill ${s.trip.status}`}>{s.trip.status}</span>
                      </div>
                      <div className="trip-card-body">
                        <h3>{s.trip.name}</h3>
                        <p>
                          {s.trip.startDate ? humanDate(s.trip.startDate) : 'Dates to be decided'}
                          {s.trip.endDate ? ` – ${humanDate(s.trip.endDate)}` : ''}
                        </p>
                        <div>
                          <div className="avatar-stack">
                            {s.trip.members
                              .filter((m) => !m.left)
                              .slice(0, 4)
                              .map((m, index) => (
                                <Avatar key={m.id} name={m.name} size="tiny" index={index} />
                              ))}
                          </div>
                          <span>
                            {s.trip.baseCurrency}
                            <ArrowRight size={17} />
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<Map />}
                  title="Your first adventure starts here"
                  text="Create a trip, add your friends, and leave the money math to us."
                >
                  <button className="button primary" onClick={() => setModal({ kind: 'trip' })}>
                    <Plus size={16} />
                    Create a trip
                  </button>
                </Empty>
              )}
            </>
          ) : (
            <>
              <div className="trip-heading">
                <div>
                  <div className="eyebrow">
                    <span className={`status-dot ${state.trip.status}`} />
                    {state.trip.status === 'active'
                      ? 'THE ADVENTURE IS ON'
                      : state.trip.status === 'settling'
                        ? 'TYING UP THE LOOSE ENDS'
                        : 'A TRIP WELL SPENT'}
                    {state.trip.id === 'sample-lisbon' && (
                      <span className="sample-label">SAMPLE TRIP</span>
                    )}
                  </div>
                  <h1>{state.trip.name}</h1>
                  <p>{state.trip.description || 'A shared adventure, a simple way to split it.'}</p>
                  {workspace.mode === 'local' && workspace.localTripMembers?.[state.trip.id] && (
                    <p className="footnote">
                      Local copy · viewing as {tripWorkspace.user.displayName}
                    </p>
                  )}
                </div>
                <div className="heading-actions">
                  <button className="button secondary" onClick={() => setModal({ kind: 'export' })}>
                    <Download size={16} />
                    Export
                  </button>
                  <button
                    className="button primary"
                    disabled={closed}
                    onClick={() => setModal({ kind: 'expense' })}
                  >
                    <Plus size={18} />
                    Add expense
                  </button>
                </div>
              </div>
              <section className="trip-banner" aria-label="Trip overview">
                <div className="trip-banner-copy">
                  <span className="pill">
                    <Globe2 size={13} />A little adventure, together
                  </span>
                  <h2>
                    Collect moments.
                    <br />
                    We'll split the rest.
                  </h2>
                  <div className="trip-meta">
                    <span>
                      <CalendarDays size={15} />
                      {state.trip.startDate ? humanDate(state.trip.startDate) : 'No dates set'}
                      {state.trip.endDate
                        ? ` – ${humanDate(state.trip.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : ''}
                    </span>
                    <span className="meta-divider" />
                    <span>{currency}</span>
                  </div>
                </div>
                <Scene />
                <div className="banner-members">
                  <div className="avatar-stack">
                    {currentMembers.slice(0, 4).map((m, i) => (
                      <Avatar key={m.id} name={m.name} index={i} size="small" />
                    ))}
                  </div>
                  <span>
                    {currentMembers.length} {currentMembers.length === 1 ? 'traveler' : 'travelers'}
                  </span>
                  {organizer && !closed && (
                    <button
                      className="banner-add"
                      aria-label="Invite a friend"
                      onClick={() => setModal({ kind: 'invite' })}
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
              </section>
              <div className="stats-grid">
                <Stat
                  icon={<Wallet size={20} />}
                  label="Total trip spending"
                  value={money(total, currency)}
                  detail={`${expenses.length} shared ${expenses.length === 1 ? 'expense' : 'expenses'}`}
                />
                <Stat
                  icon={<Users size={20} />}
                  label="Your share"
                  value={money(you?.owed ?? 0, currency)}
                  detail={`You've paid ${money(you?.paid ?? 0, currency)}`}
                />
                <Stat
                  icon={
                    (you?.net ?? 0) < 0 ? <ArrowUpRight size={21} /> : <ArrowDownLeft size={21} />
                  }
                  label={
                    (you?.net ?? 0) < 0
                      ? 'You owe'
                      : (you?.net ?? 0) > 0
                        ? 'You are owed'
                        : "You're all square"
                  }
                  value={money(Math.abs(you?.net ?? 0), currency)}
                  detail={
                    (you?.net ?? 0) === 0 ? 'Nothing left to settle' : 'After recorded payments'
                  }
                  accent={(you?.net ?? 0) >= 0}
                />
                <Stat
                  icon={<CheckCheck size={20} />}
                  label="Settle the whole trip"
                  value={`${plan.transfers.length} ${plan.transfers.length === 1 ? 'payment' : 'payments'}`}
                  detail={
                    plan.optimal ? 'The fewest possible transfers' : 'A simplified transfer plan'
                  }
                  action={() => setTab('settle')}
                />
              </div>
              <div className="workspace-tabs" role="tablist" aria-label="Trip sections">
                {(
                  [
                    ['expenses', Receipt, 'Expenses'],
                    ['balances', Wallet, 'Balances'],
                    ['settle', CheckCheck, 'Settle up'],
                    ['activity', History, 'Activity'],
                    ['members', Users, 'Trip details'],
                  ] as const
                ).map(([id, Icon, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls={`panel-${id}`}
                    id={`tab-${id}`}
                    className={tab === id ? 'active' : ''}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={17} />
                    {label}
                    {id === 'expenses' && <span>{expenses.length}</span>}
                  </button>
                ))}
              </div>
              <section
                className="tab-panel"
                role="tabpanel"
                id={`panel-${tab}`}
                aria-labelledby={`tab-${tab}`}
              >
                {tab === 'expenses' && (
                  <div className="expenses-layout">
                    <div className="panel expense-panel">
                      <div className="section-heading">
                        <div>
                          <h2>The trip, one expense at a time</h2>
                          <p>Who owes what for each expense, before recorded payments.</p>
                        </div>
                        <span className="subtle-icon">
                          <Receipt size={21} />
                        </span>
                      </div>
                      {filterBar}
                      {historyItems.length ? (
                        <div className="expense-list">
                          <div className="expense-table-head">
                            <span>EXPENSE</span>
                            <span>AMOUNT</span>
                            <span>YOUR SHARE</span>
                          </div>
                          {historyItems.map((item, index) => (
                            <div key={item.id}>
                              {(index === 0 || historyItems[index - 1].date !== item.date) && (
                                <div className="date-group">
                                  {humanDate(item.date, {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </div>
                              )}
                              {item.type === 'expense' ? (
                                <ExpenseRow
                                  expense={item.expense}
                                  state={state}
                                  workspace={tripWorkspace}
                                  onClick={() => setModal({ kind: 'detail', id: item.id })}
                                />
                              ) : (
                                <div className="expense-row payment-row">
                                  <div className="category-icon payment">
                                    <CheckCheck size={20} />
                                  </div>
                                  <div className="expense-description">
                                    <strong>
                                      {memberName(state, item.payment.fromUser)} paid{' '}
                                      {memberName(state, item.payment.toUser)}
                                    </strong>
                                    <p>
                                      {item.payment.method.replace('_', ' ')}
                                      {item.payment.note && ` · ${item.payment.note}`}
                                    </p>
                                  </div>
                                  <div className="expense-amount">
                                    {money(item.payment.amount, currency)}
                                    <small>payment recorded</small>
                                  </div>
                                  <div className="your-share">
                                    <span className="paid-badge">Paid</span>
                                  </div>
                                  <span />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          icon={<Receipt size={28} />}
                          title={
                            expenses.length ? 'No expenses found' : 'The first memory is on you'
                          }
                          text={
                            expenses.length
                              ? 'Try a different search or reset your filters.'
                              : 'Add a shared expense and we’ll work out who owes what.'
                          }
                        >
                          {!closed && (
                            <button
                              className="button secondary"
                              onClick={() => setModal({ kind: 'expense' })}
                            >
                              <Plus size={16} />
                              Add expense
                            </button>
                          )}
                        </Empty>
                      )}
                      <div className="list-footer">
                        <ShieldCheck size={14} />
                        <span>Fair to the very last cent.</span>
                        <span>{currency} · trip currency</span>
                      </div>
                    </div>
                    <aside className="expense-aside">
                      <div className="tip-card">
                        <div className="tip-icon">
                          <Sparkles size={24} />
                        </div>
                        <h3>
                          Less “who owes who?”
                          <br />
                          More “where to next?”
                        </h3>
                        <p>We turn all your shared expenses into a simple plan to settle up.</p>
                        <button onClick={() => setTab('settle')}>
                          See the settlement plan
                          <ArrowRight size={16} />
                        </button>
                        <div className="tip-doodle">
                          <span />
                          <span />
                          <span />
                          <Heart size={20} />
                        </div>
                      </div>
                      <div className="group-card">
                        <div className="section-heading">
                          <h3>Your travel crew</h3>
                          <button className="text-button" onClick={() => setTab('members')}>
                            View all
                          </button>
                        </div>
                        {currentMembers.slice(0, 5).map((m, i) => (
                          <div key={m.id}>
                            <Avatar name={m.name} index={i} size="small" />
                            <span>
                              {m.id === tripWorkspace.user.id ? `${m.name} (you)` : m.name}
                            </span>
                            {m.role === 'organizer' && <small>Organizer</small>}
                          </div>
                        ))}
                        {organizer && !closed && (
                          <button
                            className="invite-inline"
                            onClick={() => setModal({ kind: 'invite' })}
                          >
                            <Plus size={16} />
                            Invite a friend
                          </button>
                        )}
                      </div>
                    </aside>
                  </div>
                )}
                {tab === 'balances' && (
                  <div className="two-column">
                    <div className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Everyone, all accounted for</h2>
                          <p>What each person paid, used, and has left to settle.</p>
                        </div>
                      </div>
                      <div className="balance-table">
                        <div className="balance-head">
                          <span>MEMBER</span>
                          <span>PAID</span>
                          <span>SHARE</span>
                          <span>NET BALANCE</span>
                        </div>
                        {nets.map((b, i) => (
                          <div className="balance-row" key={b.userId}>
                            <span>
                              <Avatar name={memberName(state, b.userId)} index={i} size="small" />
                              <strong>
                                {b.userId === tripWorkspace.user.id
                                  ? 'You'
                                  : memberName(state, b.userId)}
                              </strong>
                            </span>
                            <span>{money(b.paid, currency)}</span>
                            <span>{money(b.owed, currency)}</span>
                            <span
                              className={b.net > 0 ? 'positive' : b.net < 0 ? 'negative' : 'muted'}
                            >
                              <strong>
                                {b.net > 0 ? '+' : ''}
                                {money(b.net, currency)}
                              </strong>
                              <small>
                                {b.net > 0 ? 'gets back' : b.net < 0 ? 'owes' : 'settled'}
                              </small>
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="info-box">
                        <ShieldCheck size={17} />
                        Net balances include recorded payments. All balances add up to zero.
                      </div>
                    </div>
                    <div className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Before simplifying</h2>
                          <p>Direct balances from expenses and payments.</p>
                        </div>
                      </div>
                      {raw.length ? (
                        raw.map((t) => (
                          <div className="pair-row" key={`${t.fromUser}-${t.toUser}`}>
                            <span>
                              <strong>{memberName(state, t.fromUser)}</strong> owes{' '}
                              {memberName(state, t.toUser)}
                            </span>
                            <strong>{money(t.amount, currency)}</strong>
                          </div>
                        ))
                      ) : (
                        <Empty
                          icon={<CheckCircle2 />}
                          title="No direct debts"
                          text="Everyone is square with one another."
                        />
                      )}
                      <p className="footnote">
                        Multi-payer expenses are allocated proportionally, with deterministic cent
                        rounding. Settle up uses net balances to remove unnecessary transfers.
                      </p>
                    </div>
                  </div>
                )}
                {tab === 'settle' && (
                  <div className="settle-layout">
                    <div className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>
                            {plan.transfers.length
                              ? 'A few payments. A clean slate.'
                              : 'All square. All smiles.'}
                          </h2>
                          <p>
                            {plan.optimal
                              ? 'The minimum number of transfers to settle this trip.'
                              : 'A simplified plan. A mathematical minimum is not guaranteed.'}
                          </p>
                        </div>
                        <span className="settle-icon">
                          <CheckCheck size={25} />
                        </span>
                      </div>
                      {plan.transfers.length ? (
                        <>
                          <div className="plan-banner">
                            <Sparkles size={17} />
                            <span>
                              <strong>
                                {plan.transfers.length}{' '}
                                {plan.transfers.length === 1 ? 'transfer' : 'transfers'}
                              </strong>{' '}
                              to settle {currentMembers.length} travelers
                            </span>
                            <span className="pill">
                              {plan.optimal ? 'Minimum plan' : 'Greedy plan'}
                            </span>
                          </div>
                          <div className="transfer-list">
                            {plan.transfers.map((t, i) => (
                              <div key={`${t.fromUser}-${t.toUser}`} className="transfer-row">
                                <span className="transfer-number">{i + 1}</span>
                                <div className="transfer-people">
                                  <Avatar
                                    name={memberName(state, t.fromUser)}
                                    index={state.trip.members.findIndex((m) => m.id === t.fromUser)}
                                  />
                                  <div>
                                    <strong>{memberName(state, t.fromUser)}</strong>
                                    <span>
                                      pays <b>{memberName(state, t.toUser)}</b>
                                    </span>
                                  </div>
                                </div>
                                <strong className="transfer-amount">
                                  {money(t.amount, currency)}
                                </strong>
                                <button
                                  className="button small secondary"
                                  disabled={closed}
                                  onClick={() => setModal({ kind: 'payment', transfer: t })}
                                >
                                  <Check size={15} />
                                  Mark paid
                                </button>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <Empty
                          icon={<CheckCircle2 size={44} />}
                          title="Nothing left to settle"
                          text="Every cent is accounted for. The only thing left is planning your next adventure."
                        />
                      )}
                      <div className="settle-bottom">
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={optimal}
                            onChange={(e) => setOptimal(e.target.checked)}
                          />
                          Find the exact minimum for small groups
                        </label>
                        <small>
                          Exact for up to 15 non-zero balances. Larger groups use deterministic
                          greedy matching.
                        </small>
                      </div>
                    </div>
                    <aside>
                      <div className="panel payment-card">
                        <Wallet size={26} />
                        <h3>Already sent some money?</h3>
                        <p>Record a full or partial payment, even if it doesn't match the plan.</p>
                        <button
                          className="button primary"
                          disabled={closed || currentMembers.length < 2}
                          onClick={() => setModal({ kind: 'payment' })}
                        >
                          <Plus size={16} />
                          Record a payment
                        </button>
                        <small>Ensemble tracks payments. It doesn't move money.</small>
                      </div>
                      <div className="settlement-note">
                        <ShieldCheck size={18} />
                        <p>
                          Recording a payment updates everyone's balances and recalculates the
                          remaining plan.
                        </p>
                      </div>
                    </aside>
                  </div>
                )}
                {tab === 'activity' && (
                  <div className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>A shared story, an open book</h2>
                        <p>Every change is recorded. No disappearing expenses.</p>
                      </div>
                      <History size={22} />
                    </div>
                    {filterBar}
                    <div className="activity-list">
                      {[...state.events]
                        .reverse()
                        .filter((e) => {
                          const expense =
                            'expenseId' in e
                              ? state.expenses.find((x) => x.id === e.expenseId)
                              : e.kind === 'expense.add'
                                ? e.expense
                                : undefined;
                          return (
                            (!member ||
                              e.actor === member ||
                              expense?.payers.some((p) => p.userId === member) ||
                              expense?.splits.some((s) => s.userId === member) ||
                              (e.kind === 'settlement.add' &&
                                [e.settlement.fromUser, e.settlement.toUser].includes(member))) &&
                            (!category || expense?.category === category) &&
                            (!start || e.updatedAt.slice(0, 10) >= start) &&
                            (!end || e.updatedAt.slice(0, 10) <= end) &&
                            (!search ||
                              `${memberName(state, e.actor)} ${eventLabel(e, (id) => memberName(state, id))} ${expense?.description ?? ''}`
                                .toLowerCase()
                                .includes(search.toLowerCase()))
                          );
                        })
                        .map((e) => (
                          <div key={e.id} className="activity-row">
                            <span
                              className={`activity-dot ${e.kind.includes('delete') ? 'deleted' : ''}`}
                            >
                              {e.kind.startsWith('expense') ? (
                                <Receipt size={16} />
                              ) : e.kind.startsWith('member') ? (
                                <Users size={16} />
                              ) : (
                                <Check size={16} />
                              )}
                            </span>
                            <div>
                              <p>
                                <strong>{memberName(state, e.actor)}</strong>{' '}
                                {eventLabel(e, (id) => memberName(state, id))}
                              </p>
                              <small>
                                {humanDate(e.updatedAt, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </small>
                            </div>
                            {'expenseId' in e && (
                              <button
                                className="text-button"
                                onClick={() => setModal({ kind: 'detail', id: e.expenseId })}
                              >
                                View
                                <ChevronRight size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                {tab === 'members' && (
                  <div className="two-column">
                    <div className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Members</h2>
                          <p>{currentMembers.length} travelers, one shared adventure.</p>
                        </div>
                        {organizer && !closed && (
                          <button
                            className="button secondary small"
                            onClick={() => setModal({ kind: 'invite' })}
                          >
                            <Plus size={16} />
                            Invite
                          </button>
                        )}
                      </div>
                      {state.trip.members.map((m, i) => (
                        <div className={`member-row ${m.left ? 'muted' : ''}`} key={m.id}>
                          <Avatar name={m.name} index={i} />
                          <div>
                            <strong>
                              {m.name}
                              {m.id === tripWorkspace.user.id && ' (you)'}
                            </strong>
                            <small>
                              {m.left
                                ? 'Left the trip'
                                : m.role === 'organizer'
                                  ? 'Trip organizer'
                                  : m.isGhost
                                    ? 'Placeholder · no account needed'
                                    : 'Trip member'}
                            </small>
                          </div>
                          {m.isGhost && organizer && !closed && (
                            <button
                              className="text-button"
                              onClick={() => setModal({ kind: 'merge', ghostId: m.id })}
                            >
                              <Link2 size={14} />
                              Merge account
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="panel settings-card">
                      <Settings2 size={23} />
                      <h3>Trip settings</h3>
                      <p>
                        This trip is <strong>{state.trip.status}</strong>.
                      </p>
                      {organizer ? (
                        <>
                          <button
                            className="button secondary"
                            disabled={busy || closed}
                            onClick={() => setModal({ kind: 'edit-trip' })}
                          >
                            <Pencil size={16} />
                            Edit trip details
                          </button>
                          {state.trip.status === 'active' && (
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    dispatch(state.trip.id, {
                                      kind: 'trip.status',
                                      status: 'settling',
                                    }),
                                  'The trip is ready to settle.',
                                )
                              }
                            >
                              <CheckCheck size={16} />
                              Start settling up
                            </button>
                          )}
                          {state.trip.status === 'settling' && (
                            <>
                              <button
                                className="button primary"
                                disabled={busy || nets.some((b) => b.net !== 0)}
                                onClick={() =>
                                  void run(
                                    () =>
                                      dispatch(state.trip.id, {
                                        kind: 'trip.status',
                                        status: 'closed',
                                      }),
                                    'Trip closed. Here’s to the next one!',
                                  )
                                }
                              >
                                <CheckCircle2 size={16} />
                                Close settled trip
                              </button>
                              {nets.some((b) => b.net !== 0) && (
                                <small>All balances must be zero before closing.</small>
                              )}
                            </>
                          )}
                          {state.trip.status !== 'active' && (
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    dispatch(state.trip.id, {
                                      kind: 'trip.status',
                                      status: 'active',
                                    }),
                                  'The trip is active again.',
                                )
                              }
                            >
                              <RotateCcw size={16} />
                              {closed ? 'Reopen trip' : 'Back to active'}
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          className="button secondary"
                          disabled={busy || you?.net !== 0 || closed}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Leave this trip? You will need a new invitation to access it again.',
                              )
                            )
                              void run(async () => {
                                await dispatch(state.trip.id, {
                                  kind: 'member.leave',
                                  userId: tripWorkspace.user.id,
                                });
                                choose(null);
                              }, 'You left the trip.');
                          }}
                        >
                          <LogOut size={16} />
                          Leave trip
                        </button>
                      )}
                      <p className="footnote">
                        Closed trips are read-only. Expenses can be added during the active and
                        settling stages. Only the organizer can change the trip stage.
                      </p>
                      {organizer && (
                        <div className="trip-delete-section">
                          <h3>Delete trip</h3>
                          <p>
                            Remove this trip from everyone’s list, even if it is already closed.
                          </p>
                          <button
                            className="button secondary danger"
                            disabled={busy}
                            onClick={() => setModal({ kind: 'delete-trip' })}
                          >
                            <Trash2 size={16} /> Delete trip
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
              <footer className="page-footer">
                <span>
                  <img src="/ensemble-icon.svg" alt="" />
                  Split fairly. Travel freely.
                </span>
                <span>
                  Made for friends, not fees.
                  <Heart size={12} />
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={modalTitle(modal, state)}
          subtitle={modalSubtitle(modal)}
          onClose={close}
          wide={modal.kind === 'expense' || modal.kind === 'detail'}
        >
          {error && ['profile', 'join', 'export', 'notices'].includes(modal.kind) && (
            <div className="dialog-error">
              <ErrorText error={error} />
              <button className="icon-button" aria-label="Dismiss error" onClick={clearError}>
                <X size={17} />
              </button>
            </div>
          )}
          {modal.kind === 'trip' && (
            <TripForm
              workspace={workspace}
              onDone={(id) => {
                choose(id);
                done('Your trip is ready. Add your travel crew next.');
              }}
            />
          )}
          {modal.kind === 'edit-trip' && state && (
            <TripForm
              workspace={tripWorkspace}
              initial={state.trip}
              onCancel={close}
              onDone={() => done('Trip details updated.')}
            />
          )}
          {modal.kind === 'delete-trip' && state && (
            <DeleteTripForm
              state={state}
              workspace={tripWorkspace}
              onCancel={close}
              onDone={() => {
                choose(null);
                done(
                  workspace.mode === 'cloud'
                    ? 'Trip deletion saved. It will sync for everyone when connected.'
                    : 'Trip deleted from your local workspace.',
                );
              }}
            />
          )}
          {modal.kind === 'auth' && (
            <AuthForm
              existingUsername={workspace.mode === 'cloud' ? workspace.user.username : undefined}
              onDone={() => {
                choose(null);
                if (joinToken) setModal({ kind: 'join' });
                else done('Welcome! Your shared workspace is ready.');
              }}
            />
          )}
          {modal.kind === 'expense' && state && (
            <ExpenseForm
              state={state}
              workspace={tripWorkspace}
              initial={modal.initial}
              onDone={() =>
                done(
                  modal.initial ? 'Expense updated.' : 'Expense added. Every cent accounted for.',
                )
              }
            />
          )}
          {modal.kind === 'payment' && state && (
            <PaymentForm
              state={state}
              transfer={modal.transfer}
              onDone={() => done('Payment recorded. Balances updated.')}
            />
          )}
          {modal.kind === 'invite' && state && (
            <InvitePanel
              state={state}
              workspace={tripWorkspace}
              onDone={() => done('Your travel crew just grew.')}
              onAuth={() => setModal({ kind: 'auth' })}
            />
          )}
          {modal.kind === 'detail' && state && (
            <ExpenseDetail
              state={state}
              id={modal.id}
              workspace={tripWorkspace}
              onEdit={(initial) => setModal({ kind: 'expense', initial })}
              onDone={done}
            />
          )}
          {modal.kind === 'export' && state && (
            <div className="form export-options">
              <button
                onClick={() => {
                  exportTripJSON(state, tripWorkspace.user);
                  done('Trip JSON exported.');
                }}
              >
                <span className="export-icon">
                  <FileText size={25} />
                </span>
                <span>
                  <strong>Download JSON</strong>
                  <small>
                    This trip only, with receipts and full history. Import as a local copy.
                  </small>
                </span>
                <Download size={18} />
              </button>
              <button
                onClick={() => {
                  exportCSV(state);
                  done('CSV exported.');
                }}
              >
                <span className="export-icon">
                  <FileText size={25} />
                </span>
                <span>
                  <strong>Download CSV</strong>
                  <small>Expenses, member totals, payments, and settlement plan.</small>
                </span>
                <Download size={18} />
              </button>
              <button
                onClick={() => {
                  try {
                    printTrip(state);
                  } catch (error) {
                    showError(error);
                  }
                }}
              >
                <span className="export-icon">
                  <Receipt size={25} />
                </span>
                <span>
                  <strong>Print / save as PDF</strong>
                  <small>A clean trip summary. Choose “Save as PDF” in the print dialog.</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <p className="footnote">
                CSV and PDF include all non-deleted expenses, not just the current filters. JSON
                also includes deleted expenses and full history. Pending offline changes are
                included. JSON files contain private financial data and receipts.
              </p>
            </div>
          )}
          {modal.kind === 'import' && (
            <ImportBackupForm
              workspace={workspace}
              onCancel={close}
              onDone={() => {
                choose(null);
                done('Backup imported into your local workspace.');
              }}
            />
          )}
          {modal.kind === 'import-trip' && (
            <ImportTripForm
              workspace={workspace}
              onCancel={close}
              onDone={(id) => {
                choose(id);
                done('Trip imported as a separate local copy.');
              }}
            />
          )}
          {modal.kind === 'profile' && (
            <div className="form">
              <div className="account-card">
                <Avatar name={workspace.user.displayName} />
                <div>
                  <h3>{workspace.user.displayName}</h3>
                  <p>
                    {workspace.mode === 'local'
                      ? 'Local workspace · this browser only'
                      : `@${workspace.user.username}`}
                  </p>
                </div>
              </div>
              {workspace.mode === 'local' ? (
                <>
                  <LocalProfileForm
                    workspace={workspace}
                    onDone={() => setMessage('Your name has been updated.')}
                  />
                  <div className="info-box">
                    You're trying Ensemble locally. The Lisbon trip is sample data you can edit
                    freely. Create a new trip for your own expenses. Nothing here is shared or
                    backed up to the cloud.
                  </div>
                  <button className="button primary" onClick={() => setModal({ kind: 'auth' })}>
                    <Cloud size={17} />
                    Sign in or create an account
                  </button>
                </>
              ) : (
                <>
                  <p className="muted">
                    Trips are private to their members. Friend search requires your exact username.
                  </p>
                  <p className="muted">
                    {workspace.lastSynced
                      ? `Last synced ${humanDate(workspace.lastSynced, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                      : 'Not synced yet'}
                  </p>
                  <button
                    className="button secondary"
                    disabled={busy || syncing}
                    onClick={() => void run(sync, 'Your trips are up to date.')}
                  >
                    <Cloud size={17} />
                    Sync now
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || syncing || workspace.pending.length > 0}
                    onClick={() =>
                      void run(async () => {
                        await logout();
                        choose(null);
                        close();
                      }, 'Signed out. Your cloud cache was removed from this browser.')
                    }
                  >
                    <LogOut size={17} />
                    Sign out
                  </button>
                </>
              )}
              <button className="button secondary" onClick={() => exportBackup(workspace)}>
                <Download size={17} />
                Export full JSON backup
              </button>
              <button
                className="button secondary"
                onClick={() => setModal({ kind: 'import-trip' })}
              >
                <Upload size={17} />
                Import trip JSON
              </button>
              <button
                className="button secondary"
                disabled={workspace.mode !== 'local' || busy || syncing}
                onClick={() => setModal({ kind: 'import' })}
              >
                <Upload size={17} />
                Import JSON backup
              </button>
              {workspace.mode === 'cloud' && (
                <p className="footnote">
                  Sign out to import a backup into your local workspace. Shared trips are never
                  overwritten by an import.
                </p>
              )}
              {workspace.mode === 'cloud' && (
                <button
                  className="text-button"
                  disabled={syncing || busy}
                  onClick={() => setModal({ kind: 'auth' })}
                >
                  Session expired? Sign in again
                </button>
              )}
              {workspace.pending.length > 0 && (
                <div className="pending-box">
                  <h3>{workspace.pending.length} pending changes</h3>
                  <p>
                    Changes stay on this device until the server accepts them. Reconnect or sign in
                    to retry. If trip membership or status changed, some edits may be rejected.
                  </p>
                  <ul>
                    {workspace.events
                      .filter((e) => workspace.pending.includes(e.id))
                      .slice(0, 10)
                      .map((e) => (
                        <li key={e.id}>
                          {e.kind} ·{' '}
                          {states.find((s) => s.trip.id === e.tripId)?.trip.name ?? e.tripId}
                        </li>
                      ))}
                  </ul>
                  <button
                    className="text-button danger"
                    disabled={syncing || busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Discard ALL unsynced changes and reload server data? Export a JSON backup first if you need to keep them. This cannot be undone.',
                        )
                      )
                        void run(
                          discardPending,
                          'Pending changes discarded. Server data reloaded.',
                        );
                    }}
                  >
                    Discard pending changes
                  </button>
                </div>
              )}
              <p className="footnote">
                Offline data is stored in this browser. On shared devices, sign out after syncing.
                Private browsing or clearing site data can erase local trips.
              </p>
            </div>
          )}
          {modal.kind === 'notices' && (
            <div className="form">
              {workspace.mode === 'local' ? (
                <Empty
                  icon={<Bell />}
                  title="Your trip, in the loop"
                  text="Sign in and use shared trips to get in-app updates when friends add expenses or record payments."
                />
              ) : (
                <>
                  {workspace.notices.length ? (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await cloudAction('notices', 'PATCH', {});
                          })
                        }
                      >
                        Mark all as read
                        <CheckCheck size={15} />
                      </button>
                      {workspace.notices.map((n) => (
                        <button
                          className={`notice ${!n.read ? 'unread' : ''}`}
                          key={n.id}
                          onClick={() => {
                            choose(n.tripId);
                            close();
                          }}
                        >
                          <Bell size={17} />
                          <span>
                            {n.message}
                            <small>
                              {humanDate(n.createdAt, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </small>
                          </span>
                        </button>
                      ))}
                    </>
                  ) : (
                    <Empty
                      icon={<CheckCheck />}
                      title="You're all caught up"
                      text="New activity from your travel crew will show up here."
                    />
                  )}
                </>
              )}
            </div>
          )}
          {modal.kind === 'help' && (
            <div className="form help-steps">
              <div>
                <span>1</span>
                <section>
                  <h3>Gather your people</h3>
                  <p>
                    Create a trip and choose its settlement currency. Add placeholders locally, or
                    sign in for invitations and shared trips.
                  </p>
                </section>
              </div>
              <div>
                <span>2</span>
                <section>
                  <h3>Collect memories, log expenses</h3>
                  <p>
                    Choose who paid and who participated. Split equally, by shares, or by exact
                    amounts. Every cent is accounted for.
                  </p>
                </section>
              </div>
              <div>
                <span>3</span>
                <section>
                  <h3>Settle up, simply</h3>
                  <p>
                    Follow the suggested transfers, pay outside the app, then record the payments.
                    The exact solver finds the minimum for up to 15 non-zero balances.
                  </p>
                </section>
              </div>
              <div className="info-box">
                Expense entry works offline after the app has loaded. Shared trips sync when you
                reconnect, and refresh every 30 seconds while visible. Receipts and exports stay
                within your trip.
              </div>
            </div>
          )}
          {modal.kind === 'join' && (
            <div className="form">
              <div className="join-art">
                <Users size={36} />
                <Heart size={20} />
              </div>
              <h3>Your friends saved you a spot.</h3>
              <p>
                Join this shared trip to see its expenses and take part. The organizer may also
                become your friend, depending on the link's settings.
              </p>
              {workspace.mode === 'local' ? (
                <button className="button primary" onClick={() => setModal({ kind: 'auth' })}>
                  Sign in to join
                  <ArrowRight size={17} />
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await cloudAction('join', 'POST', { token: joinToken });
                      history.replaceState(null, '', '/');
                      choose(result.tripId);
                      done("You're in. Let the adventure begin.");
                    })
                  }
                >
                  <Plus size={17} />
                  Join the trip
                </button>
              )}
            </div>
          )}
          {modal.kind === 'merge' && state && (
            <MergePanel
              ghostId={modal.ghostId}
              state={state}
              workspace={tripWorkspace}
              onDone={() => done('Placeholder merged. Balances moved to the account.')}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  detail,
  accent = false,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  action?: () => void;
}) {
  return (
    <div className={`stat-card ${accent ? 'accent' : ''}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">
        {detail}
        {action && (
          <button aria-label="View settlement plan" onClick={action}>
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
function ExpenseRow({
  expense: e,
  state,
  workspace,
  onClick,
}: {
  expense: Expense;
  state: TripState;
  workspace: Workspace;
  onClick: () => void;
}) {
  const Icon = categoryIcons[e.category];
  const share = e.splits.find((s) => s.userId === workspace.user.id)?.owedAmount ?? 0;
  const paidBy = e.payers
    .map((p) => (p.userId === workspace.user.id ? 'you' : memberName(state, p.userId)))
    .join(' & ');
  const paid = e.payers.find((p) => p.userId === workspace.user.id)?.amountPaid ?? 0;
  const net = e.deletedAt ? 0 : paid - share;
  const lenders = expenseTransfers(e).filter((t) => t.fromUser === workspace.user.id);
  const involved =
    e.payers.some((p) => p.userId === workspace.user.id) ||
    e.splits.some((s) => s.userId === workspace.user.id);
  const tone = net > 0 ? 'receivable' : net < 0 ? 'payable' : 'neutral';
  const label = e.deletedAt
    ? 'deleted'
    : net > 0
      ? 'you lent'
      : net < 0
        ? lenders.length === 1
          ? `${memberName(state, lenders[0].toUser)} lent you`
          : 'you borrowed'
        : involved
          ? 'no balance'
          : 'not involved';
  return (
    <button className={`expense-row ${e.deletedAt ? 'soft-deleted' : ''}`} onClick={onClick}>
      <span className={`category-icon ${e.category}`}>
        <Icon size={21} />
      </span>
      <span className="expense-description">
        <strong>
          {e.description}
          {e.deletedAt && <span className="deleted-label">Deleted</span>}
        </strong>
        <span>
          Paid by {paidBy}
          <i>·</i>
          {e.splitMethod === 'even'
            ? 'Split equally'
            : e.splitMethod === 'shares'
              ? 'Split by shares'
              : 'Exact split'}
          {e.attachments.length > 0 && <Receipt size={12} />}
        </span>
      </span>
      <span className="expense-amount">
        <span className="expense-total-label">Total</span>
        {money(e.amount, e.currency)}
        {e.currency !== state.trip.baseCurrency && (
          <small>
            {money(baseAmounts(e, state.trip.baseCurrency).total, state.trip.baseCurrency)}
          </small>
        )}
      </span>
      <span
        className={`your-share ${tone}`}
        title="Your net contribution to this expense, before recorded payments."
      >
        <small>{label}</small>
        <span className="share-amount">
          {e.deletedAt || !involved ? '—' : money(Math.abs(net), e.currency)}
        </span>
      </span>
      <ChevronRight className="expense-chevron" size={15} />
    </button>
  );
}
function modalTitle(modal: ModalState, state?: TripState) {
  switch (modal.kind) {
    case 'trip':
      return 'A new adventure';
    case 'delete-trip':
      return 'Delete this trip?';
    case 'edit-trip':
      return 'Edit trip details';
    case 'auth':
      return 'Better, together';
    case 'expense':
      return modal.initial ? 'Edit expense' : 'Add an expense';
    case 'payment':
      return 'Record a payment';
    case 'invite':
      return 'Bring your people';
    case 'detail':
      return state?.expenses.find((e) => e.id === modal.id)?.description ?? 'Expense details';
    case 'export':
      return 'Take the numbers with you';
    case 'import':
      return 'Restore a backup';
    case 'import-trip':
      return 'Import a trip';
    case 'profile':
      return 'Your workspace';
    case 'notices':
      return 'In the loop';
    case 'help':
      return 'A fair split, in three steps';
    case 'join':
      return "You're invited";
    case 'merge':
      return 'One person, one balance';
  }
}
function modalSubtitle(modal: ModalState) {
  if (modal.kind === 'expense') return 'You make the memories. We’ll do the math.';
  if (modal.kind === 'trip') return 'A place for your people, plans, and shared expenses.';
  if (modal.kind === 'auth') return 'Keep your travel crew on the same page.';
  return undefined;
}
function ExpenseDetail({
  state,
  id,
  workspace,
  onEdit,
  onDone,
}: {
  state: TripState;
  id: string;
  workspace: Workspace;
  onEdit: (expense: Expense) => void;
  onDone: (text: string) => void;
}) {
  const expense = state.expenses.find((e) => e.id === id);
  const [comment, setComment] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false);
  if (!expense) return <p>This expense is no longer available.</p>;
  const e = expense;
  const closed = state.trip.status === 'closed';
  const historyEvents = state.events.filter(
    (event) =>
      ('expenseId' in event && event.expenseId === id) ||
      (event.kind === 'expense.add' && event.expense.id === id),
  );
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form detail-content">
      <div className="detail-hero">
        <span className={`category-icon ${e.category}`}>
          {(() => {
            const Icon = categoryIcons[e.category];
            return <Icon size={24} />;
          })()}
        </span>
        <div>
          <strong>{money(e.amount, e.currency)}</strong>
          <span>
            {humanDate(e.date, { month: 'long', day: 'numeric', year: 'numeric' })} · {e.category}
          </span>
        </div>
        <span className="pill">
          {e.deletedAt
            ? 'Deleted'
            : e.splitMethod === 'even'
              ? 'Equal split'
              : e.splitMethod === 'shares'
                ? 'By shares'
                : 'Exact split'}
        </span>
      </div>
      {e.currency !== state.trip.baseCurrency && (
        <div className="info-box">
          {money(baseAmounts(e, state.trip.baseCurrency).total, state.trip.baseCurrency)} in trip
          currency · 1 {e.currency} = {e.fxRate} {state.trip.baseCurrency}
        </div>
      )}
      <div className="detail-columns">
        <section>
          <h3>Paid by</h3>
          {e.payers.map((p) => (
            <div className="detail-money-row" key={p.userId}>
              <span>{memberName(state, p.userId)}</span>
              <strong>{money(p.amountPaid, e.currency)}</strong>
            </div>
          ))}
        </section>
        <section>
          <h3>Split between</h3>
          {e.splits.map((s) => (
            <div className="detail-money-row" key={s.userId}>
              <span>
                {memberName(state, s.userId)}
                {s.shareWeight && <small>{s.shareWeight} shares</small>}
              </span>
              <strong>{money(s.owedAmount, e.currency)}</strong>
            </div>
          ))}
        </section>
      </div>
      {e.notes && (
        <div className="expense-notes">
          <h3>Notes</h3>
          <p>{e.notes}</p>
        </div>
      )}
      {e.attachments.length > 0 && (
        <div className="detail-receipts">
          {e.attachments.map((a, index) => (
            <a href={a} download={`receipt-${index + 1}.jpg`} key={index}>
              <img alt={`Receipt ${index + 1}`} src={a} />
              <span>
                <Download size={13} />
                Receipt {index + 1}
              </span>
            </a>
          ))}
        </div>
      )}
      {!closed && (
        <div className="detail-actions">
          {!e.deletedAt ? (
            <>
              <button className="button secondary" disabled={busy} onClick={() => onEdit(e)}>
                <Pencil size={16} />
                Edit expense
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Delete this expense? You can restore it from history until the trip is closed.',
                    )
                  )
                    void act(async () => {
                      await dispatch(state.trip.id, { kind: 'expense.delete', expenseId: id });
                      onDone('Expense deleted. You can restore it from Activity.');
                    });
                }}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </>
          ) : (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await dispatch(state.trip.id, { kind: 'expense.restore', expenseId: id });
                  onDone('Expense restored.');
                })
              }
            >
              <RotateCcw size={16} />
              Restore expense
            </button>
          )}
        </div>
      )}
      <div className="divider" />
      <h3>
        <MessageCircle size={17} />A note for the crew
      </h3>
      {state.comments
        .filter((c) => c.expenseId === id)
        .map((c) => (
          <div className="comment" key={c.id}>
            <Avatar name={memberName(state, c.actor)} size="tiny" />
            <div>
              <strong>{memberName(state, c.actor)}</strong>
              <small>{humanDate(c.createdAt)}</small>
              <p>{c.text}</p>
            </div>
          </div>
        ))}
      {!closed && !e.deletedAt && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await dispatch(state.trip.id, {
                kind: 'expense.comment',
                expenseId: id,
                text: comment.trim(),
              });
              setComment('');
            });
          }}
        >
          <input
            required
            maxLength={1000}
            aria-label="Comment"
            placeholder={`Add a note as ${workspace.user.displayName}…`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <button className="button secondary" disabled={busy}>
            <ArrowRight size={17} />
            Send
          </button>
        </form>
      )}
      <button
        className="text-button history-toggle"
        onClick={() => setHistoryOpen(!historyOpen)}
        aria-expanded={historyOpen}
      >
        <History size={16} />
        {historyOpen ? 'Hide' : 'View'} change history
        <ChevronDown size={15} />
      </button>
      {historyOpen && (
        <div className="detail-history">
          {[...historyEvents].reverse().map((event) => (
            <div key={event.id}>
              <span>
                <strong>{memberName(state, event.actor)}</strong>{' '}
                {eventLabel(event, (id) => memberName(state, id))}
                <small>
                  {humanDate(event.updatedAt, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </small>
              </span>
              {event.kind === 'expense.edit' && !closed && !e.deletedAt && (
                <button
                  className="text-button"
                  onClick={() => {
                    const index = state.events.findIndex((item) => item.id === event.id);
                    const laterMembership = state.events
                      .slice(index)
                      .filter((item) => item.kind === 'member.add' || item.kind === 'member.claim');
                    const before = project([
                      ...state.events.slice(0, index),
                      ...laterMembership,
                    ]).expenses.find((old) => old.id === id);
                    if (before) onEdit(before);
                  }}
                >
                  Review previous version
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
function FriendsPage({ workspace, onAuth }: { workspace: Workspace; onAuth: () => void }) {
  const [username, setUsername] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function act(path: string, method: string, data: unknown) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await cloudAction(path, method, data);
      setUsername('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update friendship.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE PEOPLE BEHIND THE MEMORIES</div>
          <h1>Your kind of people.</h1>
          <p>The best adventures start with good company.</p>
        </div>
        <Users size={32} />
      </div>
      {workspace.mode === 'local' ? (
        <div className="panel">
          <Empty
            icon={<Users size={32} />}
            title="Better with your friends"
            text="Create an account to find friends by username, share trip invitations, and keep everyone's expenses in sync."
          >
            <button className="button primary" onClick={onAuth}>
              Find your people
              <ArrowRight size={17} />
            </button>
          </Empty>
        </div>
      ) : (
        <div className="friends-layout">
          <div className="panel">
            <div className="section-heading">
              <h2>Your connections</h2>
              <span className="count-badge">
                {workspace.friends.filter((f) => f.status === 'accepted').length}
              </span>
            </div>
            {workspace.friends.length ? (
              workspace.friends.map((f, i) => (
                <div className="friend-row" key={f.id}>
                  <Avatar name={f.user.displayName} index={i} />
                  <div>
                    <strong>{f.user.displayName}</strong>
                    <small>
                      @{f.user.username} ·{' '}
                      {f.status === 'pending'
                        ? f.incoming
                          ? 'Wants to connect'
                          : 'Request sent'
                        : f.status}
                    </small>
                  </div>
                  <div className="friend-actions">
                    {f.status === 'pending' && f.incoming && (
                      <button
                        className="button small primary"
                        disabled={busy}
                        onClick={() => void act(`friends/${f.id}`, 'PATCH', { action: 'accept' })}
                      >
                        Accept
                      </button>
                    )}
                    {f.status === 'pending' && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void act(`friends/${f.id}`, 'PATCH', { action: 'decline' })}
                      >
                        {f.incoming ? 'Decline' : 'Cancel'}
                      </button>
                    )}
                    {f.status !== 'blocked' && (
                      <button
                        className="text-button muted"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Block ${f.user.displayName}? This stops friend requests but does not remove them from shared trips.`,
                            )
                          )
                            void act(`friends/${f.id}`, 'PATCH', { action: 'block' });
                        }}
                      >
                        Block
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <Empty
                icon={<Heart />}
                title="Make your first connection"
                text="Ask a friend for their username, or invite them to a trip with a link."
              />
            )}
          </div>
          <div className="panel friend-search">
            <h3>A familiar face?</h3>
            <p>Find a friend with their exact username.</p>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void act('friends', 'POST', { username });
              }}
            >
              <label>
                Username
                <input
                  autoFocus
                  required
                  maxLength={30}
                  placeholder="e.g. sam_explores"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy}>
                <Plus size={16} />
                Send friend request
              </button>
            </form>
            <p className="footnote">
              <ShieldCheck size={14} />
              Your friend list is visible only to you.
            </p>
          </div>
        </div>
      )}
      <ErrorText error={error} />
    </>
  );
}
function MergePanel({
  ghostId,
  state,
  workspace,
  onDone,
}: {
  ghostId: string;
  state: TripState;
  workspace: Workspace;
  onDone: () => void;
}) {
  const [userId, setUserId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const ghost = state.trip.members.find((m) => m.id === ghostId);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        void (async () => {
          try {
            if (workspace.mode === 'cloud')
              await cloudAction(`trips/${state.trip.id}/merge`, 'POST', { ghostId, userId });
            else
              await dispatch(state.trip.id, {
                kind: 'member.claim',
                ghostId,
                user: workspace.user,
              });
            onDone();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not merge this member.');
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <p>
        Move all of <strong>{ghost?.name}'s</strong> expenses, shares, and payments to an account
        already in this trip. This merge cannot be undone.
      </p>
      <label>
        Account
        <select required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choose a member</option>
          {state.trip.members
            .filter((m) => !m.isGhost && !m.left)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <label className="check-label">
        <input type="checkbox" required />
        These are the same person, and I want to merge their balances.
      </label>
      <ErrorText error={error} />
      <button className="button primary" disabled={busy}>
        <Link2 size={16} />
        Merge placeholder
      </button>
    </form>
  );
}
