# Appointment Scheduler — Milestones 1, 2, 3A, 3B, 3C, 4A, 4B, 5A, 5B, and 5C

A beginner-friendly React + Vite frontend connected to a Node.js + Express backend using Axios. SQLite and Prisma provide the database foundation, `GET /api/slots` exposes real slot data, registration stores bcrypt password hashes, login returns an expiring JWT, and `/api/auth/me` identifies the authenticated user. The frontend supports Register, Login, restoring a saved session, Logout, and a weekly calendar. Logged-in users select a slot and confirm **Booking**, see their booked slots after reload, cancel their own bookings, and see each slot's participant names through the Shared Schedule API.

## Requirements

For deployment preparation, PostgreSQL configuration, environment variables, and hosting commands, see [DEPLOYMENT.md](DEPLOYMENT.md). Local development keeps the existing SQLite database; production uses PostgreSQL with a separate migration history.

- Node.js 22.12 or newer (tested with Node.js 22.14.0)
- npm (included with Node.js)

## Run locally

On a fresh checkout, prepare the database once before starting the servers:

```powershell
cd C:\schedule\server
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run db:seed
```

The development workspace already has its database, generated Prisma client, and sample slots. You can skip this setup here. Prisma 6 is used for its straightforward JavaScript client and built-in SQLite support.

Open two terminals. Keep both running. On Windows PowerShell, use `npm.cmd` as shown to avoid execution-policy problems with `npm.ps1`. On macOS/Linux, use `npm` instead.

Terminal 1 — backend:

```powershell
cd C:\schedule\server
npm.cmd ci
npm.cmd run dev
```

Terminal 2 — frontend:

```powershell
cd C:\schedule\client
npm.cmd ci
npm.cmd run dev
```

Open http://localhost:5173. The Login form appears. Choose **Register** to create an account; successful registration returns to Login with a success message. Log in to see the weekly calendar and your name, reload to restore your session, and choose **Logout** to return to Login. Use **Tuần trước**, **Tuần sau**, and **Tuần hiện tại** to change the displayed week. Login requires a configured JWT_SECRET in `server/.env`; see Milestone 3B below for fresh-checkout setup.

Dependencies are already installed in the development workspace. You only need `npm.cmd ci` on a fresh checkout or when you want to reinstall dependencies from the lockfile. Stop either server with Ctrl+C in its terminal.

## Important files

```text
client/
  index.html          HTML entry point with the React root element
  package.json        Frontend dependencies and commands
  vite.config.js      React plugin, port 5173, and API proxy
  src/
    main.jsx          Mounts React and imports CSS
    App.jsx           Stores current user state, restores login, and switches pages
    styles.css        Responsive page styling
    api/axios.js      Shared Axios instance with Bearer token request interceptor
    api/tokenStorage.js Saves, reads, and removes the JWT in localStorage
    pages/
      RegisterPage.jsx Registration form, loading, and errors
      LoginPage.jsx   Login form, loading, and errors
      SchedulePage.jsx Calendar, Booking/Cancel confirmation, and participant names
    utils/calendar.js Calendar date formatting and week arithmetic
server/
  package.json        Backend dependencies and commands
  src/
    app.js            Configures JSON parsing, routes, and safe JSON errors
    routes/
      auth.routes.js  Defines POST /api/auth/register
                      POST /api/auth/login and GET /api/auth/me
      bookings.routes.js Authenticated creation, GET /me, and DELETE /:bookingId
      schedule.routes.js Authenticated GET /api/schedule with safe participant fields
    middleware/
      authenticate.js Verifies the Bearer token and sets safe req.user fields
    server.js         Starts Express on PORT (default 3000)
    config.js         Loads environment variables and validates server settings
    db.js             Selects the shared SQLite or PostgreSQL Prisma client
  prisma/
    schema.prisma     User, Slot, and Booking models
    migrations/       SQL history for building the database
    seed.js           Creates sample slots on the server
    dev.db            Local SQLite database (ignored by Git)
  test/
    database.test.js   Checks migrations, constraints, and repeatable seeding
    migration.test.js  Checks old bookings survive the schema change
    register.test.js   Checks registration through HTTP and stored bcrypt hashes
    login.test.js      Checks login, JWT signatures, payloads, and expiration
    authentication.test.js Checks middleware and GET /api/auth/me
    bookings.test.js   Checks creation, own bookings, cancellation, and ownership
    schedule.test.js   Checks relations, participant names, privacy, and shared slots
  .env.example        Example database URL and scheduling timezone
```

Each folder has its own `package.json` and `package-lock.json`. Run npm commands inside the appropriate folder; there is no root package.

## How the request works

1. `main.jsx` mounts the `App` component.
2. Register and Login forms send their values with `api.post('/auth/register', ...)` and `api.post('/auth/login', ...)`.
3. The Axios instance uses VITE_API_URL when configured, otherwise `/api`, so local requests go to `/api/auth/...` on the frontend origin. Its request interceptor adds `Authorization: Bearer <token>` when a saved JWT exists.
4. Vite forwards API requests to Express at `http://127.0.0.1:3000`.
5. Express returns JSON using `res.json()`.
6. Axios makes the parsed JSON available as `response.data`.
7. Successful login saves the token in localStorage and the safe user object in React state. React renders the user's name. Registration returns to Login instead of automatically logging in.

On startup, `App.jsx` uses an effect to call `/api/auth/me` if a token is saved. HTTP 200 restores user state; HTTP 401 removes an invalid or expired token. Network/server errors show a retry button and preserve the saved token. A five-second timeout prevents an endless loading state. The effect cancels pending requests when it unmounts. React Strict Mode can start and cancel an extra request during development; that is expected.

## API URL and CORS

Local requests use the Vite `/api` proxy. For online builds, set VITE_API_URL to the HTTPS backend URL including `/api`. Express uses CORS middleware: development permits localhost:5173 and 127.0.0.1:5173; production permits only the HTTPS FRONTEND_URL configured in the hosting environment. Preflight supports JSON, Bearer Authorization, and DELETE. See DEPLOYMENT.md for the complete settings.

## Verify the project

Implementation checks passed: both development servers started, the direct and proxied health endpoints returned the expected JSON, Vite served the HTML and transformed React component, and `npm.cmd run build` completed successfully.

With both servers running, these should return identical JSON in PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost:5173/api/health
```

Build the frontend:

```powershell
cd C:\schedule\client
npm.cmd run build
```

If the backend is stopped, submitting an auth form shows an error. Reloading with a saved token shows a session error; restart the backend and choose **Try again** to restore the session.

If a port is already occupied, stop the process using port 3000 or 5173 before restarting. Vite uses `strictPort` so it cannot silently move to a different port.

If you see `EADDRINUSE` or `Port 5173 is already in use`, a server is already running on that port. Stop the previous server with Ctrl+C in its terminal, then run the command again. Start only one backend and one frontend. If an assistant started them, ask it to stop its development sessions before starting your own.

If npm reports that `C:\schedule\package.json` is missing, you ran it from the project root. Change into `C:\schedule\server` or `C:\schedule\client` first; those folders have the package files.

If the frontend reports `'vite' is not recognized`, its dependencies may be missing, incomplete, or installed without development dependencies. Restore them from the lockfile:

```powershell
cd C:\schedule\client
npm.cmd ci --include=dev
npm.cmd run dev
```

## Milestone 2: understand the database

- **User** stores name, unique email, password hash, and creation time. No real users are seeded. The registration API trims names, trims and lowercases emails, and hashes passwords with bcrypt.
- **Slot** stores one date (`YYYY-MM-DD`) and one time interval (`HH:mm`). The date and start time must be unique together.
- **Booking** connects one user to one slot. Its unique `(userId, slotId)` constraint prevents a user from booking exactly the same slot twice. A user can book multiple slots on the same day, and any number of different users can share a slot.

`Booking.date` was removed because a booking's appointment date is available through its related `Slot.date`. This avoids duplicated date data and conflicting dates. `Booking.createdAt` remains: it records when the booking was created, which is different from the appointment date. Foreign keys enforce that referenced users and slots exist.

Migration `20260912165641_allow_multiple_daily_bookings` replaces the daily unique constraint with the user/slot unique constraint and copies existing booking IDs, user IDs, slot IDs, and creation times into the new table. It does not reset the database or delete users, slots, or booking records. Before applying this migration to another database, check for duplicate `(userId, slotId)` pairs: inconsistent old `Booking.date` values could previously have allowed such duplicates.

The SQLite URL `file:./dev.db` is relative to `server/prisma/schema.prisma`, so the file is `server/prisma/dev.db`. `src/db.js` exports one shared Prisma client for future backend routes. Neither the database file nor `.env` is committed to Git.

### Seed sample slots

```powershell
cd C:\schedule\server
npm.cmd run db:seed
```

This creates 3 slots per day (09:00–10:00, 10:00–11:00, 11:00–12:00) for 4 weeks, beginning with the current week's Monday in `SCHEDULING_TIMEZONE`. The default timezone is `Asia/Ho_Chi_Minh`.

To start on a particular Monday:

```powershell
npm.cmd run db:seed -- 2026-09-14
```

The script uses **upsert**: create a slot if it does not exist, otherwise preserve it. Rerunning it for the same weeks keeps slot IDs and bookings intact. Seeding a different range adds slots; it does not delete existing ones. Available slot definitions live on the server in `prisma/seed.js`.

### Migrations, generation, and inspection

- `npm.cmd run db:generate` creates both JavaScript clients (SQLite local and PostgreSQL production), skipping unchanged clients. Run it after installing dependencies or changing models.
- `npm.cmd run db:deploy` applies the checked-in SQLite migrations locally. Production uses `npx prisma migrate deploy` or `npm run db:deploy:production`. These commands do not reset data or create new migration files.
- `npm.cmd run db:migrate -- --name describe_your_change` creates and applies a migration after you deliberately change the schema during development. Read any reset prompt before accepting it.
- `npm.cmd run db:studio` opens Prisma Studio so you can inspect the tables. Stop it with Ctrl+C.

If Prisma reports a blank `Schema engine error` while creating a fresh database, check whether your shell sets `RUST_LOG=warn`. In this Windows development environment, that setting hid the missing-database diagnostic Prisma needs. Set `$env:RUST_LOG = 'info'` and rerun the migration command.

### Database checks

```powershell
cd C:\schedule\server
npm.cmd test
```

The checks apply the actual migrations to a temporary database, seed it twice, and verify duplicate emails, duplicate slots, shared slots, multiple daily bookings, duplicate user/slot pairs, foreign keys, and invalid seed dates. HTTP tests verify real database reads, sorting, JSON fields, empty results, and safe server errors. A separate in-memory test verifies migration preserves old-format booking records. Test users and bookings never go into the application's database.

All 15 tests passed. The application database retained its original 84 slots and IDs, both migrations are recorded as completed, and the actual `/api/slots` endpoint returned HTTP 200 with those 84 slots, directly and through the Vite proxy.

## GET /api/slots

With the backend running, open http://localhost:3000/api/slots or run:

```powershell
Invoke-RestMethod http://localhost:3000/api/slots
```

The route calls `prisma.slot.findMany()` against SQLite, sorts by `date` then `startTime`, and returns a JSON array containing only `id`, `date`, `startTime`, and `endTime`. No slots are hard-coded in the route. An empty database returns `[]` with HTTP 200. If the database query fails, the server logs the details and returns HTTP 500 with a generic JSON error, without exposing database internals.

Vite forwards http://localhost:5173/api/slots to the same backend route. This endpoint returns all slots; Milestone 4B groups them by date in the frontend and displays only the selected seven-day week. It does not return user or booking data.

## Milestone 3A: POST /api/auth/register

Send JSON containing `name`, `email`, and `password` to http://localhost:3000/api/auth/register. This creates an account; it does not log the user in or return a token.

```json
{
  "name": "Anna",
  "email": "anna@example.com",
  "password": "secret123"
}
```

Flow: parse JSON, validate input, trim name and normalize email, hash the original password asynchronously with bcrypt (10 salt rounds), then create a User through Prisma. Only `id`, `name`, `email`, and `createdAt` are selected for the response:

```json
{
  "user": {
    "id": 1,
    "name": "Anna",
    "email": "anna@example.com",
    "createdAt": "2026-09-13T00:00:00.000Z"
  }
}
```

Name and email must be non-empty strings after trimming. The password must be a string with at least 6 characters, and is never trimmed. Passwords above 72 UTF-8 bytes are rejected because [bcrypt only uses the first 72 bytes](https://github.com/kelektiv/node.bcrypt.js#security-issues-and-concerns).

Status codes:

- **201:** Account created. Neither the password nor passwordHash is returned.
- **400:** Missing/invalid fields or malformed JSON.
- **409:** Email already registered, including after trimming and lowercasing. Prisma's database unique constraint also handles simultaneous registration requests.
- **413:** JSON request body exceeds Express's parser limit.
- **500:** Unexpected server/database error. The response is generic; details stay in server logs.

Run all checks with `npm.cmd test` inside `server`. Registration tests use a temporary migrated database and an ephemeral HTTP port. They check successful creation, duplicate and simultaneous duplicate emails, validation, actual bcrypt comparison, safe response fields, and database failure handling. No test account is created in `prisma/dev.db`.

After adding registration, all 29 tests passed (the existing 15 plus 14 including the registration test's parent). The application database file was unchanged before and after the tests.

## Milestone 3B: POST /api/auth/login

`dotenv` already loads `server/.env` through `src/db.js`. Login reads `JWT_SECRET` from that environment. The development workspace has a randomly generated secret in its ignored `.env` file; its value is not in source code or `.env.example`.

On a fresh checkout, generate your own secret:

```powershell
cd C:\schedule\server
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy that generated value into `server/.env` as `JWT_SECRET="your-generated-value"`. The example file leaves this value empty deliberately. Keep the existing DATABASE_URL and timezone settings. Restart the backend after changing `.env`. A missing or blank secret causes valid-credential login to return HTTP 500; no default secret is used.

### Test with PowerShell

Start the backend in one terminal:

```powershell
cd C:\schedule\server
npm.cmd run dev
```

In another terminal, register the example account if it does not exist yet:

```powershell
$registerBody = @{
  name = 'Phuong My'
  email = 'my@example.com'
  password = '123456'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/register' -ContentType 'application/json' -Body $registerBody
```

Then log in:

```powershell
$loginBody = @{
  email = 'my@example.com'
  password = '123456'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/login' -ContentType 'application/json' -Body $loginBody | ConvertTo-Json
```

Postman alternative: choose POST, URL `http://localhost:3000/api/auth/login`, Body → raw → JSON, then send:

```json
{
  "email": "my@example.com",
  "password": "123456"
}
```

Successful login returns HTTP 200:

```json
{
  "token": "<signed JWT>",
  "user": {
    "id": 1,
    "name": "Phuong My",
    "email": "my@example.com"
  }
}
```

The example ID depends on the registered account. Neither the response nor the token contains a password or passwordHash.

### Understand the login flow

1. Check that email and password are non-empty strings. Email is trimmed and lowercased; password is preserved exactly. The bcrypt 72-byte limit applies here too.
2. Use Prisma to find the User by email, including passwordHash for internal comparison.
3. `bcrypt.compare()` checks whether the submitted password matches the stored hash. It does not decrypt a password. An unknown email or a wrong password returns the same HTTP 401 JSON error: `Invalid email or password.`
4. Sign `{ userId }` using `JWT_SECRET`, the HS256 algorithm, and `expiresIn: '1d'`. The library adds `iat` (issued at) and `exp` (expires at).
5. Return the token and only the user's ID, name, and email. Invalid input returns HTTP 400; server errors return a generic HTTP 500 JSON response.

A **JWT** is a signed token that can carry proof of a successful login. Its **payload** is the data inside it: here only userId and timing claims. Payloads are readable, so private password fields are never included. The **secret** is the private server key used to sign and later verify token signatures. **Expiration** is the time after which verification rejects a token; this project sets it to one day. The [jsonwebtoken documentation](https://github.com/auth0/node-jsonwebtoken#usage) describes signing, verification, and expiration.

Milestone 3B issues tokens. Milestone 3C below adds authentication middleware for `/api/auth/me`. Protecting other endpoints will be handled separately.

Run `npm.cmd test` inside `server` to check all features. Login tests use a temporary migrated database, accounts created through the existing Register API, and a separate random test secret. They verify all requested cases, password preservation, JWT signature/expiration, missing secret handling, and safe database errors. All 46 tests passed (the previous 29 plus 17 including the Login parent test).

## Milestone 3C: authentication middleware and GET /api/auth/me

`GET /api/auth/me` uses `src/middleware/authenticate.js` before its route handler. Send the Login token in an HTTP header:

```text
Authorization: Bearer <token>
```

The middleware checks the Bearer format, uses `jwt.verify()` with the environment's JWT_SECRET and HS256 algorithm, validates the payload's userId, and finds the User through Prisma. It selects only `id`, `name`, and `email`, attaches them to `req.user`, then calls `next()` so the route can return that user as JSON. No passwordHash is loaded or attached.

Missing/malformed Authorization headers, invalid/expired tokens, invalid user IDs, and deleted users return HTTP 401 with `{"error":"Unauthorized."}`. Unexpected database errors or missing server secret configuration return a generic HTTP 500 JSON error. No token, secret, or internal exception detail is returned to the client.

### Try /api/auth/me with PowerShell

Start or restart the backend in its terminal using `npm.cmd run dev` inside `server`. Use an already registered account; the previous section shows how to register one if needed.

```powershell
$loginBody = @{
  email = 'my@example.com'
  password = '123456'
} | ConvertTo-Json

$login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/login' -ContentType 'application/json' -Body $loginBody

Invoke-RestMethod -Method Get -Uri 'http://localhost:3000/api/auth/me' -Headers @{ Authorization = "Bearer $($login.token)" } | ConvertTo-Json
```

Successful response (the ID depends on your account):

```json
{
  "id": 1,
  "name": "Phuong My",
  "email": "my@example.com"
}
```

Opening `/api/auth/me` directly in the browser without supplying the Authorization header returns HTTP 401, as expected.

### Understand authentication

- **Middleware** runs between receiving a request and executing its route handler. Here it authenticates the request first.
- **Authorization header** is request metadata used to send credentials to the backend.
- **Bearer token** means the request carries a token as its credential, prefixed by `Bearer`.
- **jwt.verify()** checks the signature, the allowed signing algorithm, and time claims such as expiration. It returns the payload only when verification succeeds; simply decoding a token is not enough.
- **req.user** is the safe user object attached by the middleware for this request. It is read from SQLite, not accepted from a client-supplied user ID.
- **Current user** is determined by the verified JWT's userId and the matching database record. A deleted user cannot authenticate, and updated names are read on each request.

Only `/api/auth/me` uses this middleware in this milestone. Register, Login, Health, and Slots keep their existing access behavior.

Run `npm.cmd test` inside `server`. All 61 tests passed (46 existing tests plus 15 including the authentication parent). Tests cover every requested case, safe req.user fields, correct identity for two users, current database data, rejected algorithms and payloads, and generic server errors. They use temporary databases and separate test secrets; the application database remained unchanged.

## Milestone 4A: frontend Register and Login

`RegisterPage.jsx` and `LoginPage.jsx` use controlled inputs: each input's value is stored with `useState` and updated by `onChange`. Submitting prevents the browser's normal form reload, clears the previous error, shows loading, disables the form, and sends JSON through Axios. Server error messages appear in the form. Successful registration switches to Login with a success message and the registered email filled in.

After Login, `App.jsx` saves the JWT under `appointment_scheduler_token` in localStorage and stores the response's user object in its `user` state. State controls whether the app shows auth forms or the welcome screen. The JWT persists across reloads; user state does not. Passwords and user objects are not saved in localStorage.

The Axios request interceptor reads the current token and attaches its Bearer header. On startup, `/auth/me` verifies the saved token on the backend and supplies current user data to rebuild state. HTTP 401 clears the saved token; temporary network/server failures preserve it and offer retry. Logout removes the token, clears user state, and returns to Login. Page switching uses React state, so no routing or state-management library is needed yet.

Validation completed:

- Frontend production build passed; all 61 existing backend tests passed.
- 12 automated Chrome checks passed: initial Login, short-password validation, registration/loading/success redirect, duplicate email, wrong password/loading, successful Login/token storage, reload/Bearer header/current user, Logout/reload, invalid token, expired token, temporary session error/retry, and mobile layout with no JavaScript errors.
- Browser auth checks ran against this frontend and real Express/Prisma APIs with a temporary migrated SQLite database and a separate test JWT secret. They did not add accounts to `prisma/dev.db`; its checksum was unchanged. Playwright was installed only in a temporary verification directory, not as an application dependency.

To try account handling with both development servers running, open http://localhost:5173, Register a new email, Login, reload, then Logout. Milestone 4B below adds the calendar to the logged-in screen.

## Milestone 4B: read-only weekly calendar

`App.jsx` renders `SchedulePage` only when its existing user state is populated. Authentication logic and backend routes are unchanged.

`SchedulePage.jsx` uses `useEffect` to call `api.get('/slots')` when mounted and when the user retries a failed request. Axios's `/api` base URL and Vite proxy send the request to Express's existing `GET /api/slots`. The response array is saved with `setSlots(response.data)`. Loading and error state control the feedback; unmounting cancels the pending request.

The component builds `slotsByDate`, an object whose keys are YYYY-MM-DD dates and whose values are arrays of slots for that date. It generates seven dates starting on Monday. An outer `days.map()` renders those seven day cards; each day's inner `map()` renders only its server-provided slots, in the API's start-time order. Missing days still have a card saying there are no time slots. A completely empty week shows a separate message. Slot items are plain text, with no click handlers.

`weekStart` state holds the selected Monday. Previous and Next update it by -7 or +7 days. Current Week recalculates the current Monday. These controls use the already-loaded data and do not fetch or create slots. The current date uses `Asia/Ho_Chi_Minh`, matching the backend seed's default timezone. `calendar.js` performs date-only arithmetic in UTC to avoid timezone shifts and handle month/year changes.

CSS displays seven columns on desktop, two on tablet, and one on phone. All layouts retain seven day cards.

Validation: the frontend build and all 61 backend tests passed. Twelve automated checks passed using Chrome and temporary SQLite data: date arithmetic/timezone, logged-out access, Register/Login/loading, real API data and seven-day grouping, week controls without extra requests, unseeded weeks, a new database time and a missing day, API error/retry, an empty API result, year-boundary navigation, responsive columns, and Logout with no JavaScript errors. The actual localhost frontend and backend were also checked. Browser test accounts and slot changes were confined to a temporary database; no seeding or migration was run against the application database.

To check manually, open http://localhost:5173, Login, try all three week buttons, and go beyond the seeded range to see the empty-week message. Reload to check session restoration and Logout to return to Login. Slot times remain display-only. Milestone 5A below adds the Booking backend API; Shared Schedule and Cancel Booking are not implemented.

## Milestone 5A: POST /api/bookings

Send JSON containing a numeric `slotId` and the Login JWT in `Authorization: Bearer <token>`. The existing authentication middleware verifies the token, reads the User, and sets `req.user`. The route uses only `req.user.id` for ownership. A `userId` supplied in the body is ignored, so it cannot create a booking for someone else.

`slotId` must be a positive 32-bit integer. Prisma checks that the Slot exists, then creates a Booking using its slotId and the authenticated user's ID. The response selects only `id`, `userId`, `slotId`, and `createdAt`. Existing foreign keys link each booking to one User and one Slot. Each User and Slot can have many bookings. Booking dates come from Slot.date, without duplicating the date on Booking.

The existing `@@unique([userId, slotId])` constraint rejects repeat bookings for the same pair. Prisma's P2002 error is translated to HTTP 409, including for concurrent requests. Different users can share a Slot, and one user can book several different Slots on the same day. No schema change or migration is needed.

Status codes:

- **201:** Booking created.
- **400:** Missing or invalid slotId, including strings, fractions, zero, negative values, or values outside the positive 32-bit integer range. Malformed JSON is also rejected by the existing parser.
- **401:** Missing or invalid authentication token.
- **404:** Slot does not exist.
- **409:** The current user already booked that Slot.
- **500:** Unexpected database/server failure; only a generic error is sent to the client.

### Try with PowerShell

Keep the backend running with `npm.cmd run dev` inside `C:\schedule\server`. Replace the email and password below with an existing registered account. This command creates a real booking in your application's database.

```powershell
$loginBody = @{
  email = 'my@example.com'
  password = '123456'
} | ConvertTo-Json

$login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/login' -ContentType 'application/json' -Body $loginBody
$availableSlots = Invoke-RestMethod 'http://localhost:3000/api/slots'
$bookingBody = @{ slotId = $availableSlots[0].id } | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/bookings' -Headers @{ Authorization = "Bearer $($login.token)" } -ContentType 'application/json' -Body $bookingBody | ConvertTo-Json
```

Successful response (IDs and timestamp depend on the account and Slot):

```json
{
  "id": 1,
  "userId": 1,
  "slotId": 10,
  "createdAt": "2026-09-14T02:00:00.000Z"
}
```

Repeating the request with the same user and slot returns HTTP 409. If the first selected slot is already booked by your account, select another entry from `$availableSlots`.

Postman alternative: POST `http://localhost:3000/api/bookings`, Authorization type **Bearer Token** with the Login token, Body **raw → JSON** containing `{"slotId":10}`. Choose an ID from `/api/slots`; do not send userId.

Validation: `npm.cmd test` in `server` passed all **78 tests, 0 failed**: 61 existing tests plus 16 Booking subtests and their parent. Tests use real HTTP requests, the existing Register/Login middleware flow, actual migrations, and isolated SQLite data. They cover every requested business rule, persisted relationships, safe response fields, concurrent duplicates, malformed/missing bodies, and generic errors from both Slot reads and Booking writes. No application database seed, reset, or schema migration was performed. The running development endpoint also returned HTTP 401 without a JWT; Health and Slots returned HTTP 200.

Milestone 5A adds only the Booking creation API. Milestone 5B below connects it to the existing Calendar UI and includes the updated confirmation/cancellation UX. Milestone 5C adds Shared Schedule participant names.

## Milestone 5B: select, confirm Booking, and cancel your own booking

On mounting, `SchedulePage.jsx` loads `/api/slots` and `/api/bookings/me` concurrently through the existing Axios instance. Only when both requests succeed does it render the calendar. Slots and the current user's bookings are stored in separate React states. `bookingsBySlot` maps each booking's slotId to that booking so the correct slots display **✓ Đã booking**, including after a reload.

Clicking a slot only selects it; it does not send a mutation request. An unbooked selected slot reveals a **Booking** button. Confirming sends `api.post('/bookings', { slotId: slot.id })`; the Axios interceptor attaches the JWT, and the backend determines userId from req.user. HTTP 201 adds the returned Booking to local state and closes the action. A booked selected slot reveals **Hủy booking**. Confirming sends DELETE using that Booking's id, then removes it from state after HTTP 204. These updates do not reload the page.

`bookingStates` stores loading and feedback separately for each slot ID. The pending slot and its confirmation button are disabled; a ref immediately tracks pending requests to prevent rapid duplicate submissions. Other slots remain usable. Schedule unmounting aborts pending frontend requests, without undoing any database mutation already completed.

HTTP 409 triggers a read of `/bookings/me` to synchronize the affected slot if another tab already booked it. A DELETE returning 404 removes a stale local booking that was cancelled elsewhere. HTTP 401 uses the existing session-expired callback to clear token/user and return to Login. Other errors keep the previous booking state and allow retry. Milestone 5C below adds participant names while preserving this UX.

### Current user's booking APIs

`GET /api/bookings/me` requires authentication and calls `prisma.booking.findMany()` with `where: { userId: req.user.id }`. It returns only `id`, `slotId`, and `createdAt`, ordered by creation time and ID. No bookings returns HTTP 200 with `[]`; unexpected database errors return a generic HTTP 500.

`DELETE /api/bookings/:bookingId` requires authentication and a positive 32-bit booking ID. It uses `prisma.booking.deleteMany({ where: { id: bookingId, userId: req.user.id } })` to check ownership and delete in one query. One deleted row returns HTTP 204 with no body. A missing booking or a booking owned by someone else returns HTTP 404; neither can delete another user's record. Invalid IDs return HTTP 400; unexpected database errors return generic HTTP 500. Existing authentication handles HTTP 401.

Booking id identifies the user's reservation; slotId identifies the calendar time slot. They are different IDs, even when their numeric values happen to match. Cancellation deletes the Booking row, not the Slot or User. Other users' bookings for the same Slot remain. The existing schema and unique user/slot rule are unchanged; no migration is needed.

### Test in the browser and Prisma Studio

With backend and frontend running, open http://localhost:5173 and Login. Click an unbooked slot, choose **Booking**, and verify **✓ Đã booking**. Reload and verify the badge remains. Click the booked slot, choose **Hủy booking**, verify the badge disappears immediately, and reload to confirm it stays unbooked. Different slots on the same day can still be booked.

To inspect the actual application database in a third terminal:

```powershell
cd C:\schedule\server
npm.cmd run db:studio
```

Open the URL printed by Prisma Studio, normally http://localhost:5555. Choose the **Booking** model and inspect **userId**, **slotId**, and **createdAt** for your new records. Stop Studio with Ctrl+C when finished.

Validation after the UX update: frontend build passed; all **94 backend tests passed, 0 failed** (78 existing plus 16 new subtests). All **16 automated Chrome checks passed, 0 failed**, including the full Booking/reload/cancel/reload flow, no mutation on slot selection, duplicate-click protection for POST and DELETE, correct Booking ID and Bearer header, same-day/shared-slot rules, ownership, concurrent-tab synchronization, errors/retry, mobile keyboard access, and expired-token logout. Checks used real APIs and isolated migrated SQLite databases; existing application data was not reset or seeded. Shared Schedule and displaying other users' names are not implemented.

## Milestone 5C: Shared Schedule participant names

`GET /api/schedule` is a separate authenticated endpoint. It leaves `/api/slots` and all Booking APIs unchanged. Prisma reads real SQLite data with `slot.findMany()`, ordered by date and startTime. Its nested select follows Slot.bookings and Booking.user, selecting only the booking ID and user ID/name. Email, passwordHash, JWT, and other private User/Booking fields are not included. A Slot without bookings has `bookings: []`. Unexpected query failures return HTTP 500 with a generic error.

Example Slot response:

```json
{
  "id": 10,
  "date": "2026-09-14",
  "startTime": "09:00",
  "endTime": "10:00",
  "bookings": [
    { "id": 5, "user": { "id": 1, "name": "Hồ Tấn Nguyên" } },
    { "id": 8, "user": { "id": 2, "name": "Minh" } }
  ]
}
```

`SchedulePage.jsx` still loads Slots and the user's own bookings for the calendar and Booking/Cancel controls. A separate effect loads `/api/schedule` into `participantsBySlot`. Each slot maps its bookings to participant names. It adds **(Bạn)** when a participant's user.id equals the logged-in user.id from App state. IDs are compared rather than names, so users with the same name are distinguished. An empty list displays **Chưa có người tham gia**.

After POST succeeds, state immediately adds the current user's public name/ID to the slot. After DELETE succeeds, it removes only that user's entry and keeps other participants. Each successful operation also triggers a fresh `/api/schedule` read without reloading the page. The participant effect cancels outdated reads. Reloading loads current database participants and `/api/bookings/me` restores own-booking badges. Existing duplicate/conflict handling also refreshes participants.

Participant loading/errors are independent of calendar loading/errors. On initial loading each slot shows participant feedback. If the participant API fails, the calendar and Booking/Cancel remain available with an error and **Thử lại danh sách** button. Failed background refreshes preserve known participant entries. HTTP 401 continues to use the existing session-expired flow.

`/api/schedule` returns all slots with their public participant names. `/api/bookings/me` returns only the current user's booking IDs, slot IDs, and creation times for own-booking state and cancellation. Neither endpoint changes the business rules: shared slots have no capacity limit, one user can book multiple slots per day, and a user/slot pair remains unique. No schema changes or migrations are required.

To test manually with both servers running, open http://localhost:5173. Register and log in as user A, select a Slot, and confirm **Booking**. Logout, register/log in as user B, and book the same Slot. B should see both names with **(Bạn)** only next to B. Reload, cancel B's booking, and verify only A remains. Reload and log back in as A to verify A's badge and participant name persist.

Backend validation: frontend build succeeded and all **109 backend tests passed, 0 failed** (94 existing plus 14 Shared Schedule subtests and their parent). Tests check real relations, sorting, empty slots, multiple participants, exact safe fields, omitted email/passwordHash/JWT, new/cancelled bookings, current database names, own-only API behavior, authentication, and generic errors. Verification uses isolated SQLite data rather than resetting or seeding the application database.

Browser validation: **15 Chrome checks passed, 0 failed**. Two test accounts were registered through the UI. A booked, B logged in and booked the same slot, both names and the correct **(Bạn)** marker appeared, reload preserved them, B cancelled, only A remained, and logging back in as A restored its badge. Checks also covered loading, empty lists, safe response fields, participant API failures without breaking Booking/Cancel, preserved other-user entries after cancellation, 409 synchronization, mobile layout, and week navigation. All mutations belonged to a temporary SQLite database; the test tools were not added as application dependencies.

`npm audit` currently reports 3 high-severity entries in the Prisma CLI dependency chain (`prisma` → `@prisma/config` → `deepmerge-ts`). The advisory concerns recursively merging object graphs; this project does not accept user-supplied Prisma configuration. No dependency version is force-changed to suppress that report. Recheck advisories before deployment.
