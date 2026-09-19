# Ensemble

![Ensemble logo](public/ensemble-logo.svg)

A trip-first expense splitter for friends, built with React, TypeScript and Vite.
The website and API run on **Cloudflare Workers with Static Assets**, with shared
data in **Cloudflare D1**. An optional **Pages / Pages Functions** configuration is
also included. No separate application server, payment processor, or third-party
analytics is required.

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
backup before upgrading, then import it into the local workspace. Keep the
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

## Deploy to Cloudflare Workers

The default `wrangler.toml` targets **Workers Static Assets**, matching Cloudflare's
pipeline with separate build and deploy commands:

| Setting        | Value                                       |
| -------------- | ------------------------------------------- |
| Root directory | Repository root                             |
| Build command  | `npm run build`                             |
| Deploy command | `npm run deploy` (or `npx wrangler deploy`) |
| `NODE_VERSION` | `22` or newer                               |
| Dependencies   | `npm ci` using `package-lock.json`          |

`npm run deploy` runs `wrangler deploy`; it expects the build to have already run.
The configuration publishes `dist`, provides SPA fallback, and routes `/api` and
`/api/*` to `src/worker.ts` **before** static asset handling. That entry point calls
the same API handler as Pages Functions, preserving accounts, cookies, invitations,
shared trips, and D1 access. `public/_headers` continues to apply to static assets.

Unlike a static-only website, Ensemble needs a real D1 database for its API:

1. Authenticate and create your database:

   ```sh
   npx wrangler login
   npx wrangler d1 create ensemble
   ```

   If `ensemble` already exists, reuse it rather than creating another database;
   find its UUID with `npx wrangler d1 info ensemble`.

2. Replace the all-zero `database_id` in `wrangler.toml` with the real UUID.
   Keep the binding name **`DB`**. Database IDs are not credentials; never commit
   Cloudflare API tokens. The placeholder works locally, **not in production**.
   Set `name` in `wrangler.toml` to match your Cloudflare Worker project.

3. Apply the schema, build, and deploy:

   ```sh
   npm run db:remote
   npm run build
   npm run deploy
   ```

   Apply subsequent migrations separately before deploying changes that need them.
   The Workers build token needs access to the Worker and its D1 binding. A separate
   CI runner needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` configured as
   secrets; migration commands also require D1 edit permission.

4. Open the deployment URL printed by Wrangler. Create an account, create a trip,
   and use **Invite a friend** to add accepted friends or generate a join link.
   `/api/health` should return `{"ok":true}` when the D1 binding is present.

To check bundling and asset configuration without publishing:

```sh
npm run build
npx wrangler deploy --dry-run
```

A dry run does not verify remote credentials, database IDs, or applied migrations.

### Optional Cloudflare Pages deployment

Existing Pages projects can still use `wrangler.pages.toml`. Set its `database_id`
to the same real database UUID, keep the `DB` binding, and adjust the project name
in that file and the `deploy:pages` script if necessary. Then run:

```sh
npx wrangler d1 migrations apply ensemble --remote --config wrangler.pages.toml
npx wrangler pages project create ensemble --production-branch main
npm run build
npm run deploy:pages
```

Skip project creation if the Pages project already exists. `deploy:pages` explicitly
selects the Pages configuration and includes the root `functions/` directory.
For native Pages Git integration, use `npm run build`, output directory `dist`,
and no deploy command. Replace the default `wrangler.toml` with the contents of
`wrangler.pages.toml` in that deployment branch so Pages discovers its configuration.
Do not run `deploy:pages` from Workers Builds with its default token; Pages deploys
require **Account → Cloudflare Pages → Edit** permission.

Use a **separate D1 database for preview deployments**, configured through a
separate Wrangler environment or Pages `[env.preview]` binding. Worker version
previews do not automatically isolate D1 data. Do not connect untrusted
pull-request previews to production data.

Keep the same production hostname when changing hosting products if you need to
retain browser-local trips and sign-ins. Different `workers.dev`, `pages.dev`, or
custom-domain origins do not share IndexedDB or cookies.

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
| Export     | CSV totals, expenses, payments and transfers; printable/PDF summaries; versioned JSON backups and validated local restore                                          |
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
JSON backups for audit; importing a backup preserves deletion tombstones. Deleted trips
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

PDF export uses the browser print dialog. Local/demo trips and imported backups are
not automatically promoted into cloud trips.

## Export and import backups

### Individual trips

Open a trip's **Export → Download JSON** to export only that trip, including its
participants, expenses (including deleted entries), receipts, comments, payments,
status, and full edit history. These versioned files use `format: "ensemble-trip"`
and are separate from full-workspace backups. They include pending offline edits
and private financial data; share them only with people you trust.

Choose **Import trip JSON** in the sidebar or **Your account**. In local mode,
select the file, review the summary, and choose which existing non-placeholder
participant to view and edit as. Their original balances and permissions apply
only to this copy; your workspace profile does not change. Choose the organizer
if you need organizer controls. The selected identity is retained in full backups.

Import adds a separate trip with new trip, event, expense, and payment IDs. It
does not replace or merge existing trips, and importing the same file again creates
another independent copy. Participant IDs and historical event order are retained
to preserve split and FX rounding exactly. Closed trips remain closed; deleted
trips cannot be imported to bypass their tombstones. Changes to the original and
the imported copy never sync with each other.

Trip import works offline and uses the same 25 MB / 10,000-event limits and full
history validation as workspace restore. Sign out first to import locally;
exports work for both local and shared trips, but imports do not upload data to
shared accounts. Invalid files and storage failures leave existing trips intact.

### Full workspace

Open **Your account → Export full JSON backup** to download the current workspace:
profile, full trip history, expenses, receipts, comments, payments, deleted records,
and pending offline edits. JSON backups contain private financial data and receipts;
store them securely. CSV/PDF exports remain available from each trip's **Export** menu,
but cannot be imported.

In local mode, choose **Your account → Import JSON backup**. Select a file, review
the profile and record counts, and confirm **Replace my local workspace with this
backup**. Export your current workspace first if you need to retain it. Import is a
replacement, not a merge, and works offline. Saving is atomic; invalid files,
cancellation, storage failures, or changes made in another tab do not partially
overwrite your data.

New exports use the `ensemble-backup` format with `version: 1`, `exportedAt`, and
`workspace` fields. The importer also accepts older unversioned workspace JSON files.
Files are limited to 25 MB and 10,000 events. Event shapes, references, permissions,
and financial invariants are checked before import. Conflicted histories (for example,
an unsynced edit after a trip was deleted) are rejected with an error, not silently
dropped; retain the original backup for recovery.

Sign out before importing. A shared-workspace backup restores as an independent
local copy, with the backed-up user identity and valid pending edits in its history.
Friends, notifications, sessions, and sync queues are not restored, and nothing is
uploaded or changed on the server. Deleted trips stay deleted and remain in the
backup history. To resume live shared trips instead, sign into the original account.

This implementation targets small friend groups. Bootstrap currently fetches the
member's complete accessible event history; extensive receipts and long-lived
accounts will need paginated/incremental sync and object storage such as R2 before
large-scale use. History is retained indefinitely, including closed-trip
tombstones. Define retention, recovery and database backup procedures before
operating a public service, and budget for Workers/D1 quotas.

## Validation

```sh
npm test                 # domain and property-based tests
npm run format:check
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e          # Chromium + local Worker/Static Assets/D1
```

Browser tests start a local Cloudflare server on port 8788 if one is not running.
They cover expense entry, exact-sum rejection, edits/comments, payment/closure,
CSV export, JSON backup round trips and invalid-file/concurrent-tab protection,
receipt upload, mobile overflow, offline reload/reconnect, accounts,
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
src/worker.ts            Workers entry point reusing the Pages API handler
migrations/             D1 schema
public/                 Static assets, manifest and security headers
tests/                  Domain/property tests and browser/API integration tests
FEATURE_SPEC.md          Original product specification
```
