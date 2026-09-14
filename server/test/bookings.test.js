import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('Booking creation, current user bookings, and cancellation', async (t) => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'scheduler-booking-test-'));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSecret = process.env.JWT_SECRET;
  let prisma;
  let server;

  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;

    if (dirname(resolve(directory)) !== temporaryRoot
      || !basename(directory).startsWith('scheduler-booking-test-')) {
      throw new Error('Unexpected booking test cleanup path.');
    }
    await rm(directory, { recursive: true, force: true });
  });

  // All accounts and bookings below belong to an isolated SQLite database.
  process.env.DATABASE_URL = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, RUST_LOG: 'info' },
    stdio: 'pipe',
  });

  ({ default: prisma } = await import('../src/db.js'));
  const { default: app } = await import('../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function createSession(name, email) {
    const body = JSON.stringify({ name, email, password: 'secret123' });
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
    const registered = await fetch(`${baseUrl}/auth/register`, options);
    assert.equal(registered.status, 201);
    await registered.json();
    const login = await fetch(`${baseUrl}/auth/login`, options);
    assert.equal(login.status, 200);
    return login.json();
  }

  function book(body, token = my.token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${baseUrl}/bookings`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
  }

  const my = await createSession('Phuong My', 'my@example.test');
  const anna = await createSession('Anna', 'anna@example.test');
  await prisma.slot.createMany({
    data: ['09:00', '10:00', '11:00', '14:00', '15:00'].map((startTime) => ({
      date: '2026-09-14', startTime,
      endTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`,
    })),
  });
  const slots = await prisma.slot.findMany({ orderBy: { startTime: 'asc' } });
  let createdBooking;

  await t.test('a logged-in user creates a booking with HTTP 201', async () => {
    const response = await book({ slotId: slots[0].id });
    assert.equal(response.status, 201);
    assert.match(response.headers.get('content-type'), /application\/json/);
    createdBooking = await response.json();
    assert.equal(typeof createdBooking.id, 'number');
    assert.equal(createdBooking.userId, my.user.id);
    assert.equal(createdBooking.slotId, slots[0].id);
    assert.ok(!Number.isNaN(Date.parse(createdBooking.createdAt)));
    assert.equal(await prisma.booking.count(), 1);
  });

  await t.test('a request without JWT returns HTTP 401 and inserts nothing', async () => {
    const before = await prisma.booking.count();
    const response = await book({ slotId: slots[1].id }, null);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
    assert.equal(await prisma.booking.count(), before);
  });

  await t.test('an invalid JWT returns HTTP 401', async () => {
    const response = await book({ slotId: slots[1].id }, 'invalid-token');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
  });

  await t.test('missing or invalid slotId returns HTTP 400 without inserts', async () => {
    const before = await prisma.booking.count();
    for (const slotId of [undefined, null, '', '1', 0, -1, 1.5, true, {}, [], 2147483648]) {
      const response = await book({ slotId });
      assert.equal(response.status, 400, `slotId: ${JSON.stringify(slotId)}`);
      assert.deepEqual(await response.json(), { error: 'slotId must be a positive 32-bit integer.' });
    }
    assert.equal(await prisma.booking.count(), before);
  });

  await t.test('a nonexistent slot returns HTTP 404', async () => {
    const response = await book({ slotId: 2147483647 });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Slot not found.' });
    assert.equal(await prisma.booking.count({ where: { slotId: 2147483647 } }), 0);
  });

  await t.test('the same user cannot book the same slot twice', async () => {
    const response = await book({ slotId: slots[0].id });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'You have already booked this slot.' });
    assert.equal(await prisma.booking.count({ where: { userId: my.user.id, slotId: slots[0].id } }), 1);
  });

  await t.test('one user can book several different slots on the same day', async () => {
    for (const slot of slots.slice(1, 3)) {
      const response = await book({ slotId: slot.id });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).userId, my.user.id);
    }
    const bookings = await prisma.booking.findMany({
      where: { userId: my.user.id }, include: { slot: true },
    });
    assert.equal(bookings.length, 3);
    assert.ok(bookings.every((booking) => booking.slot.date === '2026-09-14'));
    assert.deepEqual(bookings.map((booking) => booking.slotId).sort((a, b) => a - b),
      slots.slice(0, 3).map((slot) => slot.id).sort((a, b) => a - b));
  });

  await t.test('different users can book the same slot', async () => {
    const response = await book({ slotId: slots[0].id }, anna.token);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).userId, anna.user.id);
    const bookings = await prisma.booking.findMany({ where: { slotId: slots[0].id } });
    assert.deepEqual(bookings.map((booking) => booking.userId).sort((a, b) => a - b),
      [my.user.id, anna.user.id].sort((a, b) => a - b));
  });

  await t.test('a body userId cannot override the user identified by JWT', async () => {
    const response = await book({ slotId: slots[3].id, userId: anna.user.id });
    assert.equal(response.status, 201);
    const booking = await response.json();
    assert.equal(booking.userId, my.user.id);
    assert.equal(await prisma.booking.count({ where: { userId: anna.user.id, slotId: slots[3].id } }), 0);
    assert.equal(await prisma.booking.count({ where: { userId: my.user.id, slotId: slots[3].id } }), 1);
  });

  await t.test('SQLite stores the correct Booking and User/Slot relationships', async () => {
    const stored = await prisma.booking.findUniqueOrThrow({
      where: { id: createdBooking.id },
      include: { user: { select: { id: true } }, slot: { select: { id: true, date: true } } },
    });
    assert.equal(stored.userId, my.user.id);
    assert.equal(stored.user.id, my.user.id);
    assert.equal(stored.slotId, slots[0].id);
    assert.equal(stored.slot.id, slots[0].id);
    assert.equal(stored.slot.date, '2026-09-14');
    assert.equal(stored.createdAt.toISOString(), createdBooking.createdAt);
  });

  await t.test('the response contains only safe Booking fields', () => {
    assert.deepEqual(Object.keys(createdBooking).sort(), ['createdAt', 'id', 'slotId', 'userId']);
    for (const field of ['password', 'passwordHash', 'email', 'user', 'slot']) {
      assert.ok(!Object.hasOwn(createdBooking, field));
    }
  });

  await t.test('simultaneous duplicate requests return one 201 and one 409', async () => {
    const responses = await Promise.all([
      book({ slotId: slots[4].id }), book({ slotId: slots[4].id }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    await Promise.all(responses.map((response) => response.json()));
    assert.equal(await prisma.booking.count({ where: { userId: my.user.id, slotId: slots[4].id } }), 1);
  });

  await t.test('a request with no body returns HTTP 400', async () => {
    const response = await fetch(`${baseUrl}/bookings`, {
      method: 'POST', headers: { Authorization: `Bearer ${my.token}` },
    });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  });

  await t.test('malformed JSON returns HTTP 400', async () => {
    const response = await fetch(`${baseUrl}/bookings`, {
      method: 'POST', headers: { Authorization: `Bearer ${my.token}`, 'Content-Type': 'application/json' },
      body: '{invalid json',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Request body must contain valid JSON.' });
  });

  await t.test('a Slot query failure returns a generic HTTP 500', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "Slot" RENAME TO "Slot_unavailable"');
    try {
      const response = await book({ slotId: slots[0].id });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to create booking. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Slot_unavailable" RENAME TO "Slot"');
    }
  });

  await t.test('a Booking write failure returns a generic HTTP 500', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "Booking" RENAME TO "Booking_unavailable"');
    try {
      const response = await book({ slotId: slots[0].id });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to create booking. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Booking_unavailable" RENAME TO "Booking"');
    }
  });

  function myBookings(token = my.token, query = '') {
    return fetch(`${baseUrl}/bookings/me${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  function cancel(bookingId, token = my.token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${baseUrl}/bookings/${bookingId}`, {
      method: 'DELETE', headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  await t.test('GET /me requires authentication', async () => {
    for (const token of [null, 'invalid-token']) {
      const response = await myBookings(token);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
    }
  });

  await t.test('GET /me returns only the JWT user bookings and ignores query userId', async () => {
    const expected = await prisma.booking.findMany({
      where: { userId: my.user.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, slotId: true, createdAt: true },
    });
    const response = await myBookings(my.token, `?userId=${anna.user.id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(expected)));
  });

  await t.test('each user sees their own bookings, including shared slots', async () => {
    const response = await myBookings(anna.token);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].slotId, slots[0].id);
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: body[0].id } });
    assert.equal(stored.userId, anna.user.id);
  });

  await t.test('GET /me returns [] for a user with no bookings', async () => {
    const empty = await createSession('Empty', 'empty@example.test');
    const response = await myBookings(empty.token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });

  await t.test('GET /me returns only id, slotId, and createdAt', async () => {
    const response = await myBookings();
    for (const booking of await response.json()) {
      assert.deepEqual(Object.keys(booking).sort(), ['createdAt', 'id', 'slotId']);
      assert.ok(!Number.isNaN(Date.parse(booking.createdAt)));
    }
  });

  await t.test('GET /me database failures return a generic HTTP 500', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "Booking" RENAME TO "Booking_unavailable"');
    try {
      const response = await myBookings();
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to load your bookings. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Booking_unavailable" RENAME TO "Booking"');
    }
  });

  await t.test('DELETE requires authentication and preserves the booking', async () => {
    for (const token of [null, 'invalid-token']) {
      const response = await cancel(createdBooking.id, token);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
    }
    assert.ok(await prisma.booking.findUnique({ where: { id: createdBooking.id } }));
  });

  await t.test('DELETE rejects invalid booking IDs without deleting anything', async () => {
    const before = await prisma.booking.count();
    for (const id of ['0', '-1', '1.5', 'abc', '1e0', '2147483648']) {
      const response = await cancel(id);
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.equal(await prisma.booking.count(), before);
  });

  await t.test('DELETE returns HTTP 404 for a nonexistent booking', async () => {
    const response = await cancel(2147483647);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Booking not found.' });
  });

  await t.test('DELETE cannot cancel another user booking even with a forged body userId', async () => {
    const before = await prisma.booking.count();
    const response = await cancel(createdBooking.id, anna.token, { userId: my.user.id });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Booking not found.' });
    assert.equal(await prisma.booking.count(), before);
    assert.ok(await prisma.booking.findUnique({ where: { id: createdBooking.id } }));
  });

  let cancelledBooking;
  await t.test('DELETE uses the Booking id, removes the real row, and preserves other bookings', async () => {
    cancelledBooking = await prisma.booking.findUniqueOrThrow({
      where: { userId_slotId: { userId: my.user.id, slotId: slots[3].id } },
    });
    assert.notEqual(cancelledBooking.id, cancelledBooking.slotId);
    const before = await prisma.booking.findMany({ orderBy: { id: 'asc' } });
    const response = await cancel(cancelledBooking.id, my.token, { userId: anna.user.id });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(await prisma.booking.findUnique({ where: { id: cancelledBooking.id } }), null);
    assert.deepEqual(await prisma.booking.findMany({ orderBy: { id: 'asc' } }),
      before.filter((booking) => booking.id !== cancelledBooking.id));
    assert.ok(await prisma.slot.findUnique({ where: { id: cancelledBooking.slotId } }));
  });

  await t.test('GET /me reflects cancellation immediately', async () => {
    const response = await myBookings();
    assert.equal(response.status, 200);
    assert.ok((await response.json()).every((booking) => booking.id !== cancelledBooking.id));
  });

  await t.test('a cancelled slot can be booked again with a new Booking id', async () => {
    const response = await book({ slotId: cancelledBooking.slotId });
    assert.equal(response.status, 201);
    const booking = await response.json();
    assert.notEqual(booking.id, cancelledBooking.id);
    assert.equal(booking.slotId, cancelledBooking.slotId);
  });

  await t.test('concurrent DELETE requests remove one booking and return 204/404', async () => {
    const target = await prisma.booking.findUniqueOrThrow({
      where: { userId_slotId: { userId: my.user.id, slotId: cancelledBooking.slotId } },
    });
    const responses = await Promise.all([cancel(target.id), cancel(target.id)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [204, 404]);
    await Promise.all(responses.map((response) => response.text()));
    assert.equal(await prisma.booking.findUnique({ where: { id: target.id } }), null);
  });

  await t.test('cancelling a shared slot leaves another user booking intact', async () => {
    const response = await cancel(createdBooking.id);
    assert.equal(response.status, 204);
    const remaining = await prisma.booking.findMany({ where: { slotId: createdBooking.slotId } });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].userId, anna.user.id);
  });

  await t.test('DELETE database failures return a generic HTTP 500', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "Booking" RENAME TO "Booking_unavailable"');
    try {
      const response = await cancel(1);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to cancel booking. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Booking_unavailable" RENAME TO "Booking"');
    }
  });
});
