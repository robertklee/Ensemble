# Ensemble

![Ensemble logo](public/ensemble-logo.svg)

A trip-first expense splitter for friends, built with React, TypeScript and Vite.
The website runs on **Cloudflare Pages**, its API on **Pages Functions**, and shared
data in **Cloudflare D1**. No separate application server, payment processor, or
third-party analytics is required.

The initial local workspace includes a clearly labeled, editable Lisbon example.
Use **Create a trip** for your own expenses, or create an account for shared trips.
Local trips and account trips are intentionally separate.

## Branding and storage

The rounded **E** mark brings three strokes
together, using the app's forest-green, sage and warm cream palette.

`public/ensemble-icon.svg` is the source icon. To regenerate the horizontal SVG
wordmark and PNG icons for installation, Android masking and Apple home screens:

```sh
npx playwright install chromium
npm run assets:icons
```

Generated assets are included in `public/`, so normal builds do not need a browser. The app's
name, favicon, install manifest, exports and offline assets all use Ensemble.
The IndexedDB database is `ensemble`, the cross-tab channel is
`ensemble-workspace`, and sessions use `ensemble_session`. Cloudflare resource
names are also `ensemble`.

When upgrading an older installation, users must sign in again. Browser-local
trips in the previous database are not migrated automatically; export a JSON
backup before upgrading (the app does not yet offer backup import). Keep the
existing D1 UUID to preserve cloud accounts and trips. Changing source names does
not rename remote Cloudflare resources or copy databases; configure the Worker
and Pages project names in Cloudflare to match before deploying.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). Local mode works without
Cloudflare credentials: trips and expenses are persisted in IndexedDB.
Vite proxies `/api` to port 8788 if a local Cloudflare server is running.

For the full application, including accounts, invitations, and shared trips:

```sh
npm run db:local
npm run cf:dev
```

Open `http://localhost:8788`. Wrangler uses a local D1 database under `.wrangler/`;
these commands do **not** create or modify a production database. The all-zero
database ID in `wrangler.toml` is a local-development placeholder.

The production build precaches its HTML, JavaScript, CSS and icons for offline
reloads. Service workers require HTTPS or localhost and are not registered by the
Vite development server. Wait for an expense form to finish saving before closing
or reloading the page.

## Deploy to Cloudflare Pages

1. Authenticate and create your database:

   ```sh
   npx wrangler login
   npx wrangler d1 create ensemble
   ```

2. Replace `database_id` in `wrangler.toml` with the UUID printed by that command.
   Keep the binding name **`DB`**. Database IDs are not credentials; never commit
   Cloudflare API tokens.

3. Apply the schema, create the Pages project, and deploy:

   ```sh
   npm run db:remote
   npx wrangler pages project create ensemble --production-branch main
   npm run deploy
   ```

   Skip project creation if the project already exists. Adjust the project name
   in `package.json` and `wrangler.toml` if `ensemble` is unavailable in your
   Cloudflare account.

4. Open the deployment URL printed by Wrangler. Create an account, create a trip,
   and use **Invite a friend** to add accepted friends or generate a join link.
   `/api/health` should return `{"ok":true}` when the D1 binding is present.

For Pages Git integration, use **`npm run build`** as the build command and
**`dist`** as the output directory; the root `functions/` directory is deployed
alongside the assets. Set `NODE_VERSION` to `22` or newer. Apply D1 migrations
separately before deploying changes that require them. Pages supplies SPA fallback
routing automatically; do not rewrite `/assets/*` or `/api/*` to `index.html`.

Use a **separate D1 database for preview deployments**. Configure a preview `DB`
binding in Cloudflare or a Pages `[env.preview]` section in `wrangler.toml`.
Do not connect untrusted pull-request previews to production data.

No deployment has been created automatically by this repository.

## Included features

| Area       | Implementation                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trips      | Names, descriptions, optional dates, settlement currency, organizer/member roles, active/settling/closed lifecycle                                                 |
| People     | Username-based accounts, friend requests, accept/decline/block, private friend list, expiring invite links, placeholder members, organizer-only placeholder merges |
| Expenses   | Multiple payers, participant subsets, equal/shares/exact splits, category/date/notes, up to three receipt photos, edits, soft deletion and restoration             |
| Balances   | Per-member paid/share/net totals, raw pairwise debts, base-currency conversion using a stored manually entered FX rate                                             |
| Settlement | Exact minimum-transfer solver for up to 15 non-zero balances; clearly labeled greedy fallback above that size; full and partial recorded payments                  |
| History    | Immutable audit events, per-expense comments, review/reapply previous expense versions, member/category/date/search filters                                        |
| Export     | CSV with per-member totals, expenses, payments and proposed transfers; printable summary with browser Save as PDF; full archival JSON export                       |
| Offline    | IndexedDB persistence, transactional writes across tabs, precached production app, durable account-event queue, reconnect/foreground synchronization               |
| Updates    | Immediate local balance recomputation, shared-trip polling every 30 seconds while visible, in-app activity notifications                                           |

Ensemble records payments made elsewhere; it does **not** transfer money.
The right-hand **Your share** column shows your net amount lent or borrowed for each
expense, with a small label above the amount: soft-green "you lent", soft-red
"Sam lent you" for one lender, or "you borrowed" for multiple lenders. Names are
shown only for a single lender. These amounts use the expense's currency,
**before recorded payments**, and net your payment against your own share.
Uninvolved, zero-balance and deleted expenses have neutral labels. On mobile, the
same right-hand column stays visible and the expense total sits below its description.

Closing a trip requires every net balance to be exactly zero. Closed trips are
read-only until the organizer reopens them. Members cannot leave with a balance,
and the organizer cannot leave their own trip.

### Delete a trip

The organizer can open **Members → Trip settings → Delete trip**, then type the
trip's exact name to confirm. Cancellation leaves everything unchanged. Active,
settling and closed trips can all be deleted. If balances are outstanding, the
dialog warns that deletion does not settle or forgive debts and offers a CSV export.

Deletion removes the trip from every member's trip list, including the local
example trip. It is a **soft deletion**, not permanent data erasure: an immutable
`trip.delete` event hides the trip while preserving its financial history.
Historical events remain available to the existing members through sync and full
JSON backups for audit; there is no restore control in the app. Deleted trips
cannot be reopened, edited or joined through old invite links.

Offline deletion is saved immediately on the organizer's device and is propagated
when connected. Other members see it on their next sync (or reconnect). If a
member queued edits while offline and the organizer deleted the trip, sync rejects
those edits, fetches the deletion, hides the trip, and keeps the queued changes
available for export or explicitly confirmed discard rather than silently losing them.
Trip deletion uses the existing event schema; no new database migration is required.

## Money and settlement correctness

`shared/` is independent of React and Cloudflare.

- Amounts are integer minor units. The supported currency list includes zero-
  decimal currencies such as JPY and three-decimal currencies such as KWD.
- Decimal share weights and exchange rates use `BigInt` rational arithmetic.
- Largest-remainder allocation, with ascending member-ID tie-breaking, preserves
  every cent. Both payer amounts and owed amounts must equal the expense total.
- FX converts the total once, then apportions that same converted total to both
  payers and participants. Independently rounding each person's conversion would
  violate the zero-sum invariant.
- Pairwise debt allocation preserves payer and participant totals, including
  multi-payer rounding. Payments reduce those direct debts.
- The exact solver uses an `O(N * 2^N)` zero-sum subset dynamic program. Maximizing
  independent zero-sum groups minimizes transfer count. Above 15 non-zero balances,
  greedy matching produces at most `N - 1` transfers, **not necessarily the minimum**.

Expense amounts and converted totals are capped at 100 billion minor units;
trips support up to 50 members. Decimal inputs support up to eight places for
weights and FX rates. Larger aggregate totals are checked for safe-integer overflow.

## Sync and conflict semantics

The event log is the source of truth; balances are derived, never stored.
Each accepted event has an ID, actor, origin, timestamp and D1 trip revision.
Server timestamps are monotonic per trip. D1 transactions use a revision comparison
to retry concurrent writes without losing either event. Retried event IDs are
idempotent.

Expense description, notes, category, date and attachments are independent
last-writer-wins fields, ordered by **server acceptance time** (event ID breaks
timestamp ties). Related financial fields are one atomic `ledger` field:
amount, currency, FX rate, payers, split method and resolved splits. This is an
intentional refinement of the draft spec: merging those fields independently can
create mathematically invalid expenses. Expense deletes remain tombstones regardless of
subsequent edits; only an explicit expense restore removes that tombstone. Trip
deletions are terminal and cannot be reversed through status changes or expense restores.

Offline events retain their IDs, are uploaded in order, and are rebased behind
acknowledged events so pending edits never replay before their expense creation.
The server revalidates membership, lifecycle and financial invariants against the
latest state. Invalid queued events are **not silently discarded**: the queue stops,
the error is shown, and the workspace offers retry/re-authentication, archival
export, or explicitly confirmed discard of pending changes.

Placeholder merges consolidate historical payer/share amounts into the real
account. Affected splits become exact amounts so rounding is not rerun and no
existing cents change. The original events remain in the audit log. Financial
edits involving a departed member require that person to rejoin; text-only edits
can still be made to historical expenses.

## Account and storage notes

- Accounts use an exact, case-insensitive username and a password of at least
  12 characters. Usernames are discoverable only by exact lookup.
- Passwords are salted PBKDF2-SHA256 hashes (100,000 iterations, the Workers Web
  Crypto limit). Session tokens and invite tokens are stored as SHA-256 hashes.
- Sessions expire after 30 days. Cookies are HttpOnly, SameSite=Strict, and Secure
  on HTTPS. Mutations require a same-origin `Origin` header and JSON bodies.
- The API checks trip membership and organizer permissions, validates input and
  enforces per-IP/account request limits. The client never receives password hashes.
- Only current trip members receive trip data. Blocking a friend does not remove
  either person from existing shared trips.
- Sign-out removes the current account's browser cache after pending changes sync.
  Offline cache is available to anyone with access to that browser profile; avoid
  leaving a shared device signed in.
- Receipts are compressed locally to JPEG, limited to roughly 180 KB each, and
  stored inline in expense events in IndexedDB/D1. Images and account data are not
  sent to third-party services.

## Deliberate v1 limits

The draft's optional email login/invites, email/push notifications, scheduled
settlement reminders, profile images and password recovery are **not implemented**.
Use a password manager: there is currently no self-service account recovery.
Notifications are in-app, and collaborative refresh is polling rather than a
WebSocket/push stream. FX rates are entered manually rather than fetched.

PDF export uses the browser print dialog. JSON exports are archival data; there is
not yet an import/restore UI. Local/demo trips are not automatically promoted into
cloud trips.

This implementation targets small friend groups. Bootstrap currently fetches the
member's complete accessible event history; extensive receipts and long-lived
accounts will need paginated/incremental sync and object storage such as R2 before
large-scale use. History is retained indefinitely, including closed-trip
tombstones. Define retention, recovery and database backup procedures before
operating a public service, and budget for Pages Functions/D1 quotas.

## Validation

```sh
npm test                 # domain and property-based tests
npm run format:check
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e          # Chromium + local Pages Functions/D1
```

Browser tests start a local Cloudflare server on port 8788 if one is not running.
They cover expense entry, exact-sum rejection, edits/comments, payment/closure,
CSV export, receipt upload, mobile overflow, offline reload/reconnect, accounts,
trip privacy, invitations and concurrent API writes. They use disposable test
usernames in the **local** database, never a remote database. Core tests include
random monetary invariants, comparison against an independent exhaustive
settlement solver, and the 20-member/1,000-expense computation threshold.

The GitHub Actions workflow runs this validation on pushes and pull requests.

## Layout

```text
src/                    React workspace, forms, offline store, export, styling
shared/                 Domain types, event projection, validation and money math
functions/api/           Cloudflare Pages API
migrations/             D1 schema
public/                 Static assets, manifest and security headers
tests/                  Domain/property tests and browser/API integration tests
FEATURE_SPEC.md          Original product specification
```
