import { eventLabel, makeEvent, project, validateEvent } from '../../shared/events';
import { CURRENCIES } from '../../shared/money';
import type { Friend, Notice, TripEvent, TripState, User } from '../../shared/types';

interface Env {
  DB: D1Database;
}
interface UserRow {
  id: string;
  username: string;
  display_name: string;
  currency: string;
  password_hash: string;
  salt: string;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function check(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
const publicUser = (u: UserRow): User => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  defaultCurrency: u.currency,
});
const iso = () => new Date().toISOString();
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100_000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (n) => n.toString(16).padStart(2, '0')).join('');
}
function equal(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}
async function body<T>(request: Request): Promise<T> {
  check(
    request.headers.get('Content-Type')?.split(';')[0] === 'application/json',
    415,
    'Send application/json.',
  );
  const reader = request.body?.getReader();
  check(reader, 400, 'Request body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 900_000) {
      await reader.cancel();
      throw new HttpError(413, 'Request is too large. Keep receipt photos under 180 KB each.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    check(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed),
      400,
      'Send a JSON object.',
    );
    return parsed as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON.');
  }
}
function validate(fn: () => void) {
  try {
    fn();
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof TypeError || error instanceof RangeError
        ? 'Malformed input. Check all required fields.'
        : error instanceof Error
          ? error.message
          : 'Invalid input.',
    );
  }
}
async function rateLimit(db: D1Database, key: string, max: number, seconds = 900) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const row = await db
    .prepare(
      'INSERT INTO rate_limits(key, window, attempts) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN window = excluded.window THEN attempts + 1 ELSE 1 END, window = excluded.window RETURNING attempts',
    )
    .bind(key, window)
    .first<{ attempts: number }>();
  check(row && row.attempts <= max, 429, 'Too many attempts. Please try again later.');
}
function sessionToken(request: Request) {
  return request.headers
    .get('Cookie')
    ?.match(/(?:^|;\s*)ensemble_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
async function currentUser(db: D1Database, request: Request): Promise<User | null> {
  const raw = sessionToken(request);
  if (!raw) return null;
  const row = await db
    .prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    )
    .bind(await hash(raw), iso())
    .first<UserRow>();
  return row ? publicUser(row) : null;
}
function cookie(raw: string, request: Request, logout = false) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `ensemble_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${logout ? 0 : 2_592_000}${secure}`;
}
async function load(
  db: D1Database,
  tripId: string,
): Promise<{ state: TripState | null; revision: number }> {
  const result = await db
    .prepare('SELECT data, revision FROM events WHERE trip_id = ? ORDER BY revision')
    .bind(tripId)
    .all<{ data: string; revision: number }>();
  return {
    state: result.results.length
      ? project(result.results.map((r) => JSON.parse(r.data) as TripEvent))
      : null,
    revision: result.results.at(-1)?.revision ?? 0,
  };
}
async function requireMember(db: D1Database, tripId: string, userId: string) {
  check(
    await db
      .prepare('SELECT 1 FROM members WHERE trip_id = ? AND user_id = ? AND active = 1')
      .bind(tripId, userId)
      .first(),
    404,
    'Trip not found or access has ended.',
  );
}
async function append(
  db: D1Database,
  incoming: TripEvent,
  user: User,
  trustedMembership = false,
): Promise<TripEvent> {
  check(
    incoming && typeof incoming.id === 'string' && typeof incoming.tripId === 'string',
    400,
    'Invalid event.',
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, revision } = await load(db, incoming.tripId);
    if (state && !trustedMembership) await requireMember(db, incoming.tripId, user.id);
    const existing = await db
      .prepare('SELECT trip_id, data FROM events WHERE id = ?')
      .bind(incoming.id)
      .first<{ trip_id: string; data: string }>();
    if (existing) {
      const saved = JSON.parse(existing.data) as TripEvent;
      check(
        existing.trip_id === incoming.tripId && saved.actor === user.id,
        409,
        'Event ID is already in use.',
      );
      return saved;
    }
    check(
      !state?.trip.deletedAt,
      410,
      'This trip has been deleted. No further changes are allowed.',
    );
    const lastTime = state ? Math.max(...state.events.map((e) => Date.parse(e.updatedAt))) : 0;
    const updatedAt = new Date(Math.max(Date.now(), lastTime + 1)).toISOString();
    const event: TripEvent = { ...incoming, actor: user.id, origin: user.id, updatedAt };
    if (event.kind === 'trip.create') {
      check(event.trip && typeof event.trip === 'object', 400, 'Trip data is required.');
      event.trip.createdAt = updatedAt;
      event.trip.createdBy = user.id;
      event.trip.members = [
        { id: user.id, name: user.displayName, role: 'organizer', isGhost: false },
      ];
    }
    if (event.kind === 'expense.add') {
      check(event.expense && typeof event.expense === 'object', 400, 'Expense data is required.');
      event.expense.createdAt = updatedAt;
      event.expense.updatedAt = updatedAt;
      event.expense.createdBy = user.id;
    }
    if (event.kind === 'settlement.add') {
      check(
        event.settlement && typeof event.settlement === 'object',
        400,
        'Payment data is required.',
      );
      event.settlement.createdAt = updatedAt;
    }
    if (event.kind === 'member.claim') {
      const target = await db
        .prepare('SELECT * FROM users WHERE id = ?')
        .bind(event.user?.id ?? '')
        .first<UserRow>();
      check(target, 400, 'Account not found.');
      event.user = publicUser(target);
    }
    validate(() => validateEvent(event, state, trustedMembership));
    const statements: D1PreparedStatement[] = [];
    if (!state)
      statements.push(
        db.prepare('INSERT OR IGNORE INTO trips(id, revision) VALUES (?, 0)').bind(event.tripId),
      );
    statements.push(
      db
        .prepare(
          'INSERT INTO events(id, trip_id, revision, data) SELECT ?, ?, ?, ? WHERE (SELECT revision FROM trips WHERE id = ?) = ?',
        )
        .bind(event.id, event.tripId, revision + 1, JSON.stringify(event), event.tripId, revision),
    );
    statements.push(
      db
        .prepare(
          'UPDATE trips SET revision = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM events WHERE id = ?)',
        )
        .bind(revision + 1, event.tripId, revision, event.id),
    );
    const joined =
      event.kind === 'trip.create'
        ? user.id
        : event.kind === 'member.add' && !event.member.isGhost
          ? event.member.id
          : null;
    if (joined)
      statements.push(
        db
          .prepare(
            'INSERT INTO members(trip_id, user_id, active) SELECT ?, ?, 1 WHERE EXISTS (SELECT 1 FROM events WHERE id = ?) ON CONFLICT(trip_id, user_id) DO UPDATE SET active = 1',
          )
          .bind(event.tripId, joined, event.id),
      );
    if (event.kind === 'member.leave')
      statements.push(
        db
          .prepare(
            'UPDATE members SET active = 0 WHERE trip_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM events WHERE id = ?)',
          )
          .bind(event.tripId, user.id, event.id),
      );
    const name = (id: string) =>
      state?.trip.members.find((m) => m.id === id)?.name ?? user.displayName;
    const message =
      event.kind === 'trip.delete'
        ? `${user.displayName} deleted “${state!.trip.name}”`
        : `${user.displayName} ${eventLabel(event, name)}`;
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO notifications(id, user_id, trip_id, message, created_at) SELECT ? || user_id, user_id, trip_id, ?, ? FROM members WHERE trip_id = ? AND active = 1 AND user_id != ? AND EXISTS (SELECT 1 FROM events WHERE id = ?)',
        )
        .bind(event.id, message, updatedAt, event.tripId, user.id, event.id),
    );
    await db.batch(statements);
    const saved = await db
      .prepare('SELECT data FROM events WHERE id = ?')
      .bind(event.id)
      .first<{ data: string }>();
    if (saved) return JSON.parse(saved.data) as TripEvent;
  }
  throw new HttpError(409, 'The trip changed while saving. Sync again to retry.');
}
async function friends(db: D1Database, userId: string): Promise<Friend[]> {
  const rows = await db
    .prepare(
      "SELECT f.id AS friendship_id, f.status, f.to_user, f.blocked_by, u.* FROM friendships f JOIN users u ON u.id = CASE WHEN f.from_user = ? THEN f.to_user ELSE f.from_user END WHERE (f.from_user = ? OR f.to_user = ?) AND (f.status != 'blocked' OR f.blocked_by = ?)",
    )
    .bind(userId, userId, userId, userId)
    .all<UserRow & { friendship_id: string; status: Friend['status']; to_user: string }>();
  return rows.results.map((r) => ({
    id: r.friendship_id,
    user: publicUser(r),
    status: r.status,
    incoming: r.to_user === userId,
  }));
}
async function handle(request: Request, db: D1Database) {
  const url = new URL(request.url);
  const path = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);
  const method = request.method;
  if (!['GET', 'HEAD'].includes(method))
    check(
      request.headers.get('Origin') === url.origin,
      403,
      'Cross-origin requests are not allowed.',
    );
  if (path[0] === 'health') return json({ ok: true });
  if (path[0] === 'auth' && ['login', 'signup'].includes(path[1]) && method === 'POST') {
    const input = await body<{
      username: string;
      password: string;
      displayName?: string;
      currency?: string;
    }>(request);
    check(
      typeof input.username === 'string' && /^[a-zA-Z0-9_]{3,30}$/.test(input.username),
      400,
      'Username must be 3–30 letters, numbers or underscores.',
    );
    check(
      typeof input.password === 'string' &&
        input.password.length >= 12 &&
        input.password.length <= 200,
      400,
      'Use a password between 12 and 200 characters.',
    );
    await rateLimit(
      db,
      `auth-ip:${await hash(request.headers.get('CF-Connecting-IP') ?? 'local')}`,
      30,
    );
    await rateLimit(db, `auth-user:${input.username.toLowerCase()}`, 10);
    let row = await db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind(input.username)
      .first<UserRow>();
    if (path[1] === 'signup') {
      check(!row, 409, 'That username is unavailable.');
      check(
        typeof input.displayName === 'string' &&
          input.displayName.trim().length > 0 &&
          input.displayName.length <= 60,
        400,
        'Enter a display name (up to 60 characters).',
      );
      check(
        input.currency && CURRENCIES.includes(input.currency),
        400,
        'Choose a supported currency.',
      );
      row = {
        id: crypto.randomUUID(),
        username: input.username.toLowerCase(),
        display_name: input.displayName.trim(),
        currency: input.currency,
        salt: token(),
        password_hash: '',
      };
      row.password_hash = await passwordHash(input.password, row.salt);
      await db
        .prepare(
          'INSERT INTO users(id, username, display_name, currency, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          row.id,
          row.username,
          row.display_name,
          row.currency,
          row.password_hash,
          row.salt,
          iso(),
        )
        .run();
    } else {
      const candidate = await passwordHash(
        input.password,
        row?.salt ?? 'ensemble-invalid-account-constant-salt',
      );
      check(row && equal(candidate, row.password_hash), 401, 'Incorrect username or password.');
    }
    const raw = token();
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(iso()),
      db
        .prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(await hash(raw), row.id, new Date(Date.now() + 2_592_000_000).toISOString()),
    ]);
    return json({ user: publicUser(row) }, 200, { 'Set-Cookie': cookie(raw, request) });
  }
  if (path[0] === 'auth' && path[1] === 'logout' && method === 'POST') {
    const raw = sessionToken(request);
    if (raw)
      await db
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(await hash(raw))
        .run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', request, true) });
  }
  const user = await currentUser(db, request);
  if (path[0] === 'session' && method === 'GET') return json({ user });
  check(user, 401, 'Sign in to sync your trips.');
  if (method !== 'GET') await rateLimit(db, `write:${user.id}`, 180, 60);
  if (path[0] === 'bootstrap' && method === 'GET') {
    const rows = await db
      .prepare(
        'SELECT e.data FROM events e JOIN members m ON m.trip_id = e.trip_id WHERE m.user_id = ? AND m.active = 1 ORDER BY e.trip_id, e.revision',
      )
      .bind(user.id)
      .all<{ data: string }>();
    const notifications = await db
      .prepare(
        'SELECT id, trip_id AS tripId, message, created_at AS createdAt, is_read AS read FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      )
      .bind(user.id)
      .all<Notice>();
    return json({
      user,
      events: rows.results.map((r) => JSON.parse(r.data)),
      friends: await friends(db, user.id),
      notices: notifications.results,
    });
  }
  if (path[0] === 'events' && method === 'POST') {
    const input = await body<{ event: TripEvent }>(request);
    check(
      (input.event && !['member.claim', 'member.add'].includes(input.event.kind)) ||
        (input.event?.kind === 'member.add' && input.event.member?.isGhost),
      400,
      'Use the member invitation or merge endpoint.',
    );
    return json({ event: await append(db, input.event, user) });
  }
  if (path[0] === 'friends' && method === 'POST') {
    const input = await body<{ username: string }>(request);
    check(
      typeof input.username === 'string' && input.username.length <= 30,
      400,
      'Enter an exact username.',
    );
    const target = await db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind(input.username)
      .first<UserRow>();
    check(target && target.id !== user.id, 404, 'No other account found with that username.');
    const pair = [user.id, target.id].sort().join(':');
    const existing = await db
      .prepare('SELECT status FROM friendships WHERE pair_key = ?')
      .bind(pair)
      .first<{ status: string }>();
    check(!existing, 409, 'A connection already exists or requests are unavailable.');
    await db
      .prepare(
        "INSERT INTO friendships(id, from_user, to_user, pair_key, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      )
      .bind(crypto.randomUUID(), user.id, target.id, pair, iso())
      .run();
    return json({ friends: await friends(db, user.id) });
  }
  if (path[0] === 'friends' && path[1] && method === 'PATCH') {
    const input = await body<{ action: string }>(request);
    const f = await db
      .prepare('SELECT * FROM friendships WHERE id = ? AND (from_user = ? OR to_user = ?)')
      .bind(path[1], user.id, user.id)
      .first<{ status: string; from_user: string; to_user: string; blocked_by: string | null }>();
    check(f, 404, 'Request not found.');
    if (input.action === 'accept') {
      check(
        f.to_user === user.id && f.status === 'pending',
        403,
        'Only the recipient can accept a pending request.',
      );
      await db
        .prepare("UPDATE friendships SET status = 'accepted' WHERE id = ? AND status = 'pending'")
        .bind(path[1])
        .run();
    } else if (input.action === 'decline') {
      check(f.status === 'pending', 400, 'Only pending requests can be declined.');
      await db
        .prepare("DELETE FROM friendships WHERE id = ? AND status = 'pending'")
        .bind(path[1])
        .run();
    } else if (input.action === 'block') {
      check(f.status !== 'blocked' || f.blocked_by === user.id, 403, 'Connection unavailable.');
      await db
        .prepare(
          "UPDATE friendships SET status = 'blocked', blocked_by = ? WHERE id = ? AND status != 'blocked'",
        )
        .bind(user.id, path[1])
        .run();
    } else throw new HttpError(400, 'Unknown friendship action.');
    return json({ friends: await friends(db, user.id) });
  }
  if (path[0] === 'notices' && method === 'PATCH') {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true });
  }
  if (path[0] === 'trips' && path[1]) {
    const tripId = path[1];
    await requireMember(db, tripId, user.id);
    const { state } = await load(db, tripId);
    check(state, 404, 'Trip not found.');
    check(!state.trip.deletedAt, 410, 'This trip has been deleted.');
    const organizer = state.trip.members.some((m) => m.id === user.id && m.role === 'organizer');
    if (path[2] === 'invite' && method === 'POST') {
      check(
        organizer && state.trip.status !== 'closed',
        403,
        'Only the organizer can invite people to an open trip.',
      );
      const input = await body<{ makeFriends?: boolean; friendId?: string }>(request);
      if (input.friendId) {
        const f = await db
          .prepare("SELECT 1 FROM friendships WHERE pair_key = ? AND status = 'accepted'")
          .bind([user.id, input.friendId].sort().join(':'))
          .first();
        check(f, 403, 'Only accepted friends can be added directly.');
        const target = await db
          .prepare('SELECT * FROM users WHERE id = ?')
          .bind(input.friendId)
          .first<UserRow>();
        check(target, 404, 'Friend not found.');
        await append(
          db,
          makeEvent(tripId, user.id, {
            kind: 'member.add',
            member: { id: target.id, name: target.display_name, isGhost: false, role: 'member' },
          }),
          user,
          true,
        );
        return json({ ok: true });
      }
      const raw = token();
      await db
        .prepare(
          'INSERT INTO invites(token_hash, trip_id, created_by, expires_at, make_friends) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(
          await hash(raw),
          tripId,
          user.id,
          new Date(Date.now() + 604_800_000).toISOString(),
          input.makeFriends === false ? 0 : 1,
        )
        .run();
      return json({ url: `${url.origin}/?join=${raw}` });
    }
    if (path[2] === 'merge' && method === 'POST') {
      const input = await body<{ ghostId: string; userId: string }>(request);
      check(
        organizer && typeof input.ghostId === 'string' && typeof input.userId === 'string',
        403,
        'Only the organizer can merge a placeholder.',
      );
      const target = await db
        .prepare('SELECT * FROM users WHERE id = ?')
        .bind(input.userId)
        .first<UserRow>();
      check(target, 404, 'Account not found.');
      await append(
        db,
        makeEvent(tripId, user.id, {
          kind: 'member.claim',
          ghostId: input.ghostId,
          user: publicUser(target),
        }),
        user,
      );
      return json({ ok: true });
    }
  }
  if (path[0] === 'join' && method === 'POST') {
    const input = await body<{ token: string }>(request);
    check(
      typeof input.token === 'string' && /^[a-f0-9]{64}$/.test(input.token),
      400,
      'Invalid invite link.',
    );
    const invite = await db
      .prepare('SELECT * FROM invites WHERE token_hash = ? AND expires_at > ?')
      .bind(await hash(input.token), iso())
      .first<{ trip_id: string; created_by: string; make_friends: number }>();
    check(invite, 404, 'This invite link is invalid or has expired.');
    const { state } = await load(db, invite.trip_id);
    check(!state?.trip.deletedAt, 410, 'This trip has been deleted.');
    check(state && state.trip.status !== 'closed', 400, 'This trip is closed.');
    if (!state.trip.members.some((m) => m.id === user.id && !m.left)) {
      await append(
        db,
        makeEvent(invite.trip_id, user.id, {
          kind: 'member.add',
          member: { id: user.id, name: user.displayName, isGhost: false, role: 'member' },
        }),
        user,
        true,
      );
    }
    if (invite.make_friends && invite.created_by !== user.id) {
      await db
        .prepare(
          "INSERT INTO friendships(id, from_user, to_user, pair_key, status, created_at) VALUES (?, ?, ?, ?, 'accepted', ?) ON CONFLICT(pair_key) DO UPDATE SET status = 'accepted' WHERE status = 'pending'",
        )
        .bind(
          crypto.randomUUID(),
          invite.created_by,
          user.id,
          [invite.created_by, user.id].sort().join(':'),
          iso(),
        )
        .run();
    }
    return json({ tripId: invite.trip_id });
  }
  throw new HttpError(404, 'API endpoint not found.');
}
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    check(
      env.DB,
      503,
      'Cloud sync is not configured. Use local mode, or bind a D1 database to enable accounts.',
    );
    return await handle(request, env.DB);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Ensemble API failure', error);
    return json({ error: 'The server could not complete this request. Please try again.' }, 500);
  }
};
