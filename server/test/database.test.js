import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

test('SQLite schema and slot seed', async (t) => {
  // These checks use a separate temporary database, never prisma/dev.db.
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'scheduler-db-test-'));
  const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
  const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
  // Prisma needs engine diagnostics enabled to recognize a missing SQLite file
  // and create it. The development sandbox sets RUST_LOG=warn globally.
  const environment = { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info' };
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let apiPrisma;
  let httpServer;

  t.after(async () => {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve());
      });
    }
    if (apiPrisma) await apiPrisma.$disconnect();
    await prisma.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;

    // Verify the target stays inside the OS temporary folder before deleting it.
    if (dirname(resolve(directory)) !== temporaryRoot
      || !basename(directory).startsWith('scheduler-db-test-')) {
      throw new Error('Unexpected test cleanup path.');
    }

    await rm(directory, { recursive: true, force: true });
  });

  function runNode(script, args = []) {
    return execFileSync(process.execPath, [script, ...args], {
      cwd: serverDirectory,
      env: environment,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }

  // Apply the actual migration files, so tests exercise the shipped schema.
  runNode('node_modules/prisma/build/index.js', ['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);

  await t.test('seeding twice produces 84 slots without creating users or bookings', async () => {
    runNode('prisma/seed.js', ['2026-09-14']);
    assert.equal(await prisma.slot.count(), 84);
    const originalIds = (await prisma.slot.findMany({ orderBy: { id: 'asc' } })).map((slot) => slot.id);

    runNode('prisma/seed.js', ['2026-09-14']);
    assert.equal(await prisma.slot.count(), 84);
    assert.deepEqual((await prisma.slot.findMany({ orderBy: { id: 'asc' } })).map((slot) => slot.id), originalIds);
    assert.equal(await prisma.user.count(), 0);
    assert.equal(await prisma.booking.count(), 0);
    assert.equal(await prisma.slot.count({ where: { date: '2026-09-14' } }), 3);
    assert.equal(await prisma.slot.count({ where: { date: '2026-10-11' } }), 3);
  });

  await t.test('invalid seed dates fail without changing slots', async () => {
    for (const date of ['2026-02-30', '2026-09-15', 'not-a-date']) {
      assert.throws(() => runNode('prisma/seed.js', [date]));
    }
    assert.equal(await prisma.slot.count(), 84);
  });

  const anna = await prisma.user.create({
    data: { name: 'Anna', email: 'anna@example.test', passwordHash: 'test-only-placeholder' },
  });
  const john = await prisma.user.create({
    data: { name: 'John', email: 'john@example.test', passwordHash: 'test-only-placeholder' },
  });
  const mondaySlots = await prisma.slot.findMany({
    where: { date: '2026-09-14' }, orderBy: { startTime: 'asc' },
  });

  await t.test('duplicate email addresses are rejected', async () => {
    await assert.rejects(prisma.user.create({
      data: { name: 'Another Anna', email: anna.email, passwordHash: 'test-only-placeholder' },
    }), { code: 'P2002' });
  });

  await t.test('duplicate slots for the same date and start time are rejected', async () => {
    await assert.rejects(prisma.slot.create({
      data: { date: '2026-09-14', startTime: '09:00', endTime: '10:00' },
    }), { code: 'P2002' });
  });

  await t.test('two users can book the same slot and query participant names', async () => {
    for (const user of [anna, john]) {
      await prisma.booking.create({
        data: { userId: user.id, slotId: mondaySlots[0].id },
      });
    }

    const bookings = await prisma.booking.findMany({
      where: { slotId: mondaySlots[0].id },
      select: { user: { select: { name: true } } },
    });
    assert.deepEqual(bookings.map((booking) => booking.user.name).sort(), ['Anna', 'John']);
  });

  await t.test('a duplicate booking for the exact same user and slot is rejected', async () => {
    await assert.rejects(prisma.booking.create({
      data: { userId: anna.id, slotId: mondaySlots[0].id },
    }), { code: 'P2002' });
  });

  await t.test('one user can book all three slots on the same day', async () => {
    for (const slot of mondaySlots.slice(1)) {
      await prisma.booking.create({ data: { userId: anna.id, slotId: slot.id } });
    }
    const bookings = await prisma.booking.findMany({
      where: { userId: anna.id }, include: { slot: { select: { date: true } } },
    });
    assert.equal(bookings.length, 3);
    assert.ok(bookings.every((booking) => booking.slot.date === '2026-09-14'));
    assert.ok(bookings.every((booking) => !Object.hasOwn(booking, 'date')));
  });

  await t.test('the same user can book on another day', async () => {
    const tuesday = await prisma.slot.findFirstOrThrow({ where: { date: '2026-09-15' } });
    await prisma.booking.create({
      data: { userId: anna.id, slotId: tuesday.id },
    });
    assert.equal(await prisma.booking.count({ where: { userId: anna.id } }), 4);
  });

  await t.test('bookings cannot reference missing users or slots', async () => {
    await assert.rejects(prisma.booking.create({
      data: { userId: 999999, slotId: mondaySlots[0].id },
    }), { code: 'P2003' });
    await assert.rejects(prisma.booking.create({
      data: { userId: anna.id, slotId: 999999 },
    }), { code: 'P2003' });
  });

  // Load the actual Express app with its Prisma connection pointing at our
  // temporary database. No application data is changed by these HTTP tests.
  process.env.DATABASE_URL = databaseUrl;
  const { default: app } = await import('../src/app.js');
  ({ default: apiPrisma } = await import('../src/db.js'));
  httpServer = app.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

  await t.test('GET /api/health still returns HTTP 200', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  });

  await t.test('GET /api/slots reads real rows, sorts them, and reflects database changes', async () => {
    const extraSlots = [];
    for (const startTime of ['18:00', '08:00']) {
      extraSlots.push(await prisma.slot.create({
        data: { date: '2026-09-13', startTime, endTime: startTime === '18:00' ? '19:00' : '09:00' },
      }));
    }
    const response = await fetch(`${baseUrl}/api/slots`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const slots = await response.json();
    assert.equal(slots.length, 86);
    assert.equal(slots[0].id, extraSlots[1].id);
    assert.equal(slots[1].id, extraSlots[0].id);
    for (let index = 0; index < slots.length; index += 1) {
      assert.deepEqual(Object.keys(slots[index]).sort(), ['date', 'endTime', 'id', 'startTime']);
      if (index > 0) {
        const previous = slots[index - 1];
        const current = slots[index];
        assert.ok(previous.date < current.date
          || (previous.date === current.date && previous.startTime <= current.startTime));
      }
    }

    await prisma.slot.delete({ where: { id: extraSlots[0].id } });
    const updatedResponse = await fetch(`${baseUrl}/api/slots`);
    const updated = await updatedResponse.json();
    assert.equal(updatedResponse.status, 200);
    assert.equal(updated.length, 85);
    assert.ok(!updated.some((slot) => slot.id === extraSlots[0].id));
  });

  await t.test('GET /api/slots returns a safe HTTP 500 response on a database error', async (t) => {
    t.mock.method(console, 'error', () => {});
    // Make the real Slot table temporarily unavailable in this test database.
    await prisma.$executeRawUnsafe('ALTER TABLE "Slot" RENAME TO "Slot_unavailable"');
    try {
      const response = await fetch(`${baseUrl}/api/slots`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to load slots. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Slot_unavailable" RENAME TO "Slot"');
    }
  });

  await t.test('GET /api/slots returns HTTP 200 and an empty array when no slots exist', async () => {
    await prisma.$transaction([prisma.booking.deleteMany(), prisma.slot.deleteMany()]);
    const response = await fetch(`${baseUrl}/api/slots`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});
