import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';

// Optional integration suite: use a test PostgreSQL database, never DATABASE_URL.
// Each run creates and removes only its own randomly named PostgreSQL schema.
test('PostgreSQL production migrations, seed and APIs', {
  skip: !process.env.TEST_POSTGRES_DATABASE_URL && 'Set TEST_POSTGRES_DATABASE_URL to run PostgreSQL integration tests.',
}, async (t) => {
  const schema = 'scheduler_test_' + randomBytes(8).toString('hex');
  const url = new URL(process.env.TEST_POSTGRES_DATABASE_URL);
  assert.match(url.protocol, /^postgres(ql)?:$/);
  url.searchParams.set('schema', schema);
  const databaseUrl = url.toString();
  const previous = Object.fromEntries(['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV', 'FRONTEND_URL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl, JWT_SECRET: randomBytes(32).toString('hex'),
    NODE_ENV: 'production', FRONTEND_URL: 'https://casting.example.test',
  });
  let prisma, server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      if (prisma) {
        assert.match(schema, /^scheduler_test_[0-9a-f]{16}$/);
        await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
      }
    } finally {
      await prisma?.$disconnect();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  function run(script, args) {
    // Keep subprocess output private: connection URLs must not appear in test logs.
    try {
      return execFileSync(process.execPath, [script, ...args], {
        cwd, env: { ...process.env, RUST_LOG: 'info' }, stdio: 'pipe', encoding: 'utf8',
      });
    } catch {
      throw new Error('PostgreSQL integration subprocess failed: ' + script);
    }
  }
  const migrate = () => run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
  const seed = () => run('prisma/seed.js', ['2026-09-14']);
  await t.test('PostgreSQL and SQLite have identical models and business rules', async () => {
    const sqlite = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    const postgres = await readFile(new URL('../prisma/postgresql/schema.prisma', import.meta.url), 'utf8');
    const models = source => source.slice(source.indexOf('model User')).replaceAll('\r\n', '\n').trim();
    assert.equal(models(sqlite), models(postgres));
  });
  await t.test('default prisma migrate deploy applies the PostgreSQL migration', async () => {
    migrate();
    ({ default: prisma } = await import('../src/db.js'));
    const migrations = await prisma.$queryRawUnsafe('SELECT migration_name, finished_at FROM "_prisma_migrations"');
    assert.equal(migrations.length, 1);
    assert.equal(migrations[0].migration_name, '20260914000000_init');
    assert.ok(migrations[0].finished_at);
    run('node_modules/prisma/build/index.js', ['migrate', 'status']);
  });
  await t.test('the migrated PostgreSQL database matches the Prisma schema without drift', () => {
    run('node_modules/prisma/build/index.js', [
      'migrate', 'diff', '--from-url', databaseUrl,
      '--to-schema-datamodel', 'prisma/postgresql/schema.prisma', '--exit-code',
    ]);
  });
  await t.test('seeding twice creates 84 slots with stable IDs and no users or bookings', async () => {
    seed();
    const before = await prisma.slot.findMany({ orderBy: { id: 'asc' } });
    seed();
    assert.equal(before.length, 84);
    assert.deepEqual(await prisma.slot.findMany({ orderBy: { id: 'asc' } }), before);
    assert.equal(await prisma.user.count(), 0);
    assert.equal(await prisma.booking.count(), 0);
  });
  const { default: app } = await import('../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  async function request(path, { method = 'GET', body, token } = {}) {
    return fetch(base + path, { method, headers: {
      Origin: process.env.FRONTEND_URL,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  const alice = { name: 'Test Alice', email: 'alice@postgres.test', password: 'secret123' };
  const bob = { name: 'Test Bob', email: 'bob@postgres.test', password: 'secret123' };
  let userA, userB, tokenA, tokenB, slots, bookingA, bookingB;
  await t.test('Register stores bcrypt hashes and safe user responses in PostgreSQL', async () => {
    for (const input of [alice, bob]) {
      const response = await request('/auth/register', { method: 'POST', body: input });
      assert.equal(response.status, 201);
      const { user } = await response.json();
      assert.ok(!Object.hasOwn(user, 'passwordHash'));
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(await bcrypt.compare(input.password, stored.passwordHash), true);
      if (input === alice) userA = user;
      else userB = user;
    }
  });
  await t.test('Login, normalized email, JWT and /auth/me work with PostgreSQL', async () => {
    for (const [credentials, user] of [[alice, userA], [bob, userB]]) {
      const response = await request('/auth/login', { method: 'POST', body: {
        email: '  ' + credentials.email.toUpperCase() + '  ', password: credentials.password,
      } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(typeof body.token, 'string');
      assert.deepEqual(body.user, { id: user.id, name: user.name, email: user.email });
      const me = await request('/auth/me', { token: body.token });
      assert.equal(me.status, 200);
      assert.deepEqual(await me.json(), body.user);
      if (credentials === alice) tokenA = body.token;
      else tokenB = body.token;
    }
  });
  await t.test('/slots returns real PostgreSQL rows sorted by date and startTime', async () => {
    const response = await request('/slots');
    assert.equal(response.status, 200);
    slots = await response.json();
    assert.equal(slots.length, 84);
    assert.deepEqual(slots, await prisma.slot.findMany({
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: { id: true, date: true, startTime: true, endTime: true },
    }));
  });
  await t.test('shared slots and multiple daily bookings remain allowed', async () => {
    for (const [token, slotId] of [[tokenA, slots[0].id], [tokenA, slots[1].id], [tokenB, slots[0].id]]) {
      const response = await request('/bookings', { method: 'POST', body: { slotId }, token });
      assert.equal(response.status, 201);
      const booking = await response.json();
      if (token === tokenA && slotId === slots[0].id) bookingA = booking;
      if (token === tokenB) bookingB = booking;
    }
    assert.equal(await prisma.booking.count(), 3);
    assert.equal(slots[0].date, slots[1].date);
  });
  await t.test('PostgreSQL enforces unique email, unique slots, unique user/slot and foreign keys', async () => {
    const response = await request('/bookings', { method: 'POST', body: { slotId: slots[0].id }, token: tokenA });
    assert.equal(response.status, 409);
    await response.json();
    await assert.rejects(prisma.booking.create({ data: { userId: userA.id, slotId: slots[0].id } }), { code: 'P2002' });
    await assert.rejects(prisma.user.create({ data: { name: 'Duplicate', email: alice.email, passwordHash: 'test-only' } }), { code: 'P2002' });
    await assert.rejects(prisma.slot.create({ data: { date: slots[0].date, startTime: slots[0].startTime, endTime: slots[0].endTime } }), { code: 'P2002' });
    await assert.rejects(prisma.booking.create({ data: { userId: userA.id, slotId: 2147483647 } }), { code: 'P2003' });
  });
  await t.test('rerunning migration and seed preserves all users, bookings and slot IDs', async () => {
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    const bookings = await prisma.booking.findMany({ orderBy: { id: 'asc' } });
    const originalSlots = await prisma.slot.findMany({ orderBy: { id: 'asc' } });
    migrate();
    seed();
    assert.deepEqual(await prisma.user.findMany({ orderBy: { id: 'asc' } }), users);
    assert.deepEqual(await prisma.booking.findMany({ orderBy: { id: 'asc' } }), bookings);
    assert.deepEqual(await prisma.slot.findMany({ orderBy: { id: 'asc' } }), originalSlots);
    assert.equal(await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "_prisma_migrations"').then(rows => rows[0].count), 1);
  });
  await t.test('Shared Schedule selects only public participant id/name; empty slots return []', async () => {
    const response = await request('/schedule', { token: tokenB });
    assert.equal(response.status, 200);
    const schedule = await response.json();
    const shared = schedule.find(slot => slot.id === slots[0].id);
    assert.equal(shared.bookings.length, 2);
    assert.deepEqual(shared.bookings.map(booking => Object.keys(booking.user).sort()), [['id', 'name'], ['id', 'name']]);
    assert.deepEqual(schedule.find(slot => slot.id === slots[2].id).bookings, []);
    const json = JSON.stringify(schedule);
    for (const field of ['email', 'passwordHash', 'password', 'token']) assert.ok(!json.includes('"' + field + '"'));
  });
  await t.test('Cancel checks ownership, deletes real rows and preserves other participants', async () => {
    const forbidden = await request('/bookings/' + bookingA.id, { method: 'DELETE', token: tokenB });
    assert.equal(forbidden.status, 404);
    await forbidden.json();
    const response = await request('/bookings/' + bookingB.id, { method: 'DELETE', token: tokenB });
    assert.equal(response.status, 204);
    assert.equal(await prisma.booking.count(), 2);
    const shared = await request('/schedule', { token: tokenA }).then(response => response.json());
    assert.deepEqual(shared.find(slot => slot.id === slots[0].id).bookings.map(booking => booking.user.id), [userA.id]);
    assert.deepEqual(await request('/bookings/me', { token: tokenB }).then(response => response.json()), []);
    assert.equal(await request('/bookings/me', { token: tokenA }).then(response => response.json()).then(rows => rows.length), 2);
  });
});

