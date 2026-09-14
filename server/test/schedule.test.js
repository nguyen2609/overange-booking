import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('GET /api/schedule', async (t) => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'scheduler-shared-test-'));
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
      || !basename(directory).startsWith('scheduler-shared-test-')) {
      throw new Error('Unexpected shared schedule cleanup path.');
    }
    await rm(directory, { recursive: true, force: true });
  });

  process.env.DATABASE_URL = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, RUST_LOG: 'info' }, stdio: 'pipe',
  });
  ({ default: prisma } = await import('../src/db.js'));
  const { default: app } = await import('../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function createSession(name, email) {
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'secret123' }) };
    const registered = await fetch(`${baseUrl}/auth/register`, options);
    assert.equal(registered.status, 201);
    await registered.json();
    const login = await fetch(`${baseUrl}/auth/login`, options);
    assert.equal(login.status, 200);
    return login.json();
  }

  function schedule(token = my.token) {
    return fetch(`${baseUrl}/schedule`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }

  async function book(slotId, token) {
    const response = await fetch(`${baseUrl}/bookings`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(response.status, 201);
    return response.json();
  }

  const my = await createSession('Hồ Tấn Nguyên', 'nguyen@example.test');
  const minh = await createSession('Minh', 'minh@example.test');
  await prisma.slot.createMany({ data: [
    { date: '2026-09-15', startTime: '10:00', endTime: '11:00' },
    { date: '2026-09-14', startTime: '10:00', endTime: '11:00' },
    { date: '2026-09-14', startTime: '09:00', endTime: '10:00' },
  ] });
  const slots = await prisma.slot.findMany({ orderBy: [{ date: 'asc' }, { startTime: 'asc' }] });
  let myBooking;
  let minhBooking;

  await t.test('returns real Slots sorted by date then startTime', async () => {
    const response = await schedule();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.json();
    assert.deepEqual(body.map(({ bookings, ...slot }) => slot), slots);
    assert.deepEqual(body.map((slot) => `${slot.date} ${slot.startTime}`),
      ['2026-09-14 09:00', '2026-09-14 10:00', '2026-09-15 10:00']);
  });

  await t.test('Slots without bookings return empty arrays', async () => {
    for (const slot of await (await schedule()).json()) assert.deepEqual(slot.bookings, []);
  });

  await t.test('a new Booking appears through Slot → Booking → User relations', async () => {
    myBooking = await book(slots[0].id, my.token);
    const slot = (await (await schedule()).json()).find((slot) => slot.id === slots[0].id);
    assert.deepEqual(slot.bookings, [{ id: myBooking.id, user: { id: my.user.id, name: my.user.name } }]);
  });

  await t.test('two users can book one Slot and both names are returned', async () => {
    minhBooking = await book(slots[0].id, minh.token);
    const slot = (await (await schedule()).json()).find((slot) => slot.id === slots[0].id);
    assert.deepEqual(slot.bookings, [
      { id: myBooking.id, user: { id: my.user.id, name: my.user.name } },
      { id: minhBooking.id, user: { id: minh.user.id, name: minh.user.name } },
    ]);
    assert.equal(await prisma.booking.count({ where: { slotId: slots[0].id } }), 2);
  });

  await t.test('only necessary Slot, Booking, and User fields are selected', async () => {
    for (const slot of await (await schedule()).json()) {
      assert.deepEqual(Object.keys(slot).sort(), ['bookings', 'date', 'endTime', 'id', 'startTime']);
      for (const booking of slot.bookings) {
        assert.deepEqual(Object.keys(booking).sort(), ['id', 'user']);
        assert.deepEqual(Object.keys(booking.user).sort(), ['id', 'name']);
      }
    }
  });

  await t.test('neither current nor other user email is exposed', async () => {
    const text = await (await schedule()).text();
    assert.ok(!text.includes('"email"'));
    assert.ok(!text.includes(my.user.email));
    assert.ok(!text.includes(minh.user.email));
  });

  await t.test('password hashes, passwords, JWTs, and private fields are absent', async () => {
    const text = await (await schedule()).text();
    for (const field of ['password', 'passwordHash', 'token', 'createdAt', 'userId', 'slotId']) {
      assert.ok(!text.includes(`"${field}"`));
    }
    assert.ok(!text.includes(my.token));
    assert.ok(!text.includes(minh.token));
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: my.user.id } });
    assert.ok(!text.includes(stored.passwordHash));
  });

  await t.test('Shared Schedule includes other participants while /bookings/me remains own-only', async () => {
    const response = await fetch(`${baseUrl}/bookings/me`, { headers: { Authorization: `Bearer ${my.token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((booking) => booking.id), [myBooking.id]);
    const slot = (await (await schedule(minh.token)).json()).find((slot) => slot.id === slots[0].id);
    assert.equal(slot.bookings.length, 2);
  });

  await t.test('cancellation removes only that user from the shared Slot', async () => {
    const response = await fetch(`${baseUrl}/bookings/${minhBooking.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${minh.token}` },
    });
    assert.equal(response.status, 204);
    const slot = (await (await schedule()).json()).find((slot) => slot.id === slots[0].id);
    assert.deepEqual(slot.bookings, [{ id: myBooking.id, user: { id: my.user.id, name: my.user.name } }]);
    assert.ok(await prisma.booking.findUnique({ where: { id: myBooking.id } }));
    assert.equal(await prisma.booking.findUnique({ where: { id: minhBooking.id } }), null);
  });

  await t.test('one user can still book another Slot on the same day', async () => {
    await book(slots[1].id, my.token);
    const body = await (await schedule()).json();
    assert.equal(body.filter((slot) => slot.bookings.some((booking) => booking.user.id === my.user.id)).length, 2);
  });

  await t.test('participant names are read from current SQLite data on each request', async () => {
    await prisma.user.update({ where: { id: my.user.id }, data: { name: 'Nguyên Updated' } });
    const slot = (await (await schedule()).json()).find((slot) => slot.id === slots[0].id);
    assert.equal(slot.bookings[0].user.name, 'Nguyên Updated');
  });

  await t.test('missing or invalid JWT returns HTTP 401', async () => {
    for (const token of [null, 'invalid-token']) {
      const response = await schedule(token);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
    }
  });

  await t.test('relation query failures return a generic HTTP 500', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "Booking" RENAME TO "Booking_unavailable"');
    try {
      const response = await schedule();
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to load shared schedule. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Booking_unavailable" RENAME TO "Booking"');
    }
  });

  await t.test('a database without Slots returns HTTP 200 and []', async () => {
    await prisma.booking.deleteMany();
    await prisma.slot.deleteMany();
    const response = await schedule();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});
