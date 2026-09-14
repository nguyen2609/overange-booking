import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';

test('POST /api/auth/register', async (t) => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'scheduler-register-test-'));
  const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let prisma;
  let server;

  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;

    if (dirname(resolve(directory)) !== temporaryRoot
      || !basename(directory).startsWith('scheduler-register-test-')) {
      throw new Error('Unexpected register test cleanup path.');
    }
    await rm(directory, { recursive: true, force: true });
  });

  // Set the URL before importing the app, so its real Prisma client uses only
  // this temporary database. Never create test accounts in prisma/dev.db.
  process.env.DATABASE_URL = databaseUrl;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, RUST_LOG: 'info' },
    stdio: 'pipe',
  });

  ({ default: prisma } = await import('../src/db.js'));
  const { default: app } = await import('../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const registerUrl = `http://127.0.0.1:${server.address().port}/api/auth/register`;

  function register(body) {
    return fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const input = { name: '  Anna  ', email: '  Anna@Example.Test  ', password: 'secret123' };
  let registeredUser;

  await t.test('successful registration returns HTTP 201 and normalized account fields', async () => {
    const response = await register(input);
    assert.equal(response.status, 201);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.json();
    registeredUser = body.user;
    assert.equal(typeof registeredUser.id, 'number');
    assert.equal(registeredUser.name, 'Anna');
    assert.equal(registeredUser.email, 'anna@example.test');
    assert.ok(!Number.isNaN(Date.parse(registeredUser.createdAt)));
    assert.equal(await prisma.user.count(), 1);
  });

  await t.test('the response contains neither password nor passwordHash', () => {
    assert.deepEqual(Object.keys(registeredUser).sort(), ['createdAt', 'email', 'id', 'name']);
    assert.ok(!Object.hasOwn(registeredUser, 'passwordHash'));
    assert.ok(!Object.hasOwn(registeredUser, 'password'));
  });

  await t.test('the database stores a bcrypt hash that matches the submitted password', async () => {
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: registeredUser.id } });
    assert.notEqual(stored.passwordHash, input.password);
    assert.equal(bcrypt.getRounds(stored.passwordHash), 10);
    assert.equal(await bcrypt.compare(input.password, stored.passwordHash), true);
    assert.equal(await bcrypt.compare('incorrect-password', stored.passwordHash), false);
    assert.ok(!Object.hasOwn(stored, 'password'));
  });

  await t.test('a duplicate email returns HTTP 409 and creates no extra account', async () => {
    const response = await register({ ...input, name: 'Different Anna', email: 'anna@example.test' });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Email is already registered.' });
    assert.equal(await prisma.user.count(), 1);
  });

  await t.test('email duplicates are detected after trimming and lowercasing', async () => {
    const response = await register({ ...input, email: ' ANNA@EXAMPLE.TEST ' });
    assert.equal(response.status, 409);
    assert.equal(await prisma.user.count(), 1);
  });

  await t.test('passwords shorter than six characters return HTTP 400', async () => {
    const response = await register({ ...input, email: 'short@example.test', password: '12345' });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Password must be at least 6 characters.' });
    assert.equal(await prisma.user.count({ where: { email: 'short@example.test' } }), 0);
  });

  await t.test('a six-character password is accepted without trimming its spaces', async () => {
    const response = await register({ name: 'Six', email: 'six@example.test', password: ' 1234 ' });
    assert.equal(response.status, 201);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'six@example.test' } });
    assert.equal(await bcrypt.compare(' 1234 ', stored.passwordHash), true);
    assert.equal(await bcrypt.compare('1234', stored.passwordHash), false);
  });

  await t.test('missing, empty, whitespace-only, or non-string name/email is rejected', async () => {
    const countBefore = await prisma.user.count();
    for (const field of ['name', 'email']) {
      for (const value of [undefined, '', '   ', 123, null]) {
        const response = await register({ ...input, [field]: value });
        assert.equal(response.status, 400);
        assert.equal(typeof (await response.json()).error, 'string');
      }
    }
    assert.equal(await prisma.user.count(), countBefore);
  });

  await t.test('missing or non-string passwords are rejected', async () => {
    for (const password of [undefined, null, 123456, {}, []]) {
      const response = await register({ ...input, password });
      assert.equal(response.status, 400);
    }
  });

  await t.test('passwords over bcrypt UTF-8 byte limit are rejected', async () => {
    for (const password of ['a'.repeat(73), 'é'.repeat(37)]) {
      const response = await register({ ...input, password });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Password must not exceed 72 UTF-8 bytes.' });
    }
  });

  await t.test('concurrent duplicate registrations create exactly one account', async () => {
    const body = { name: 'Concurrent', email: 'concurrent@example.test', password: 'secret123' };
    const responses = await Promise.all([register(body), register(body)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    await Promise.all(responses.map((response) => response.json()));
    assert.equal(await prisma.user.count({ where: { email: body.email } }), 1);
  });

  await t.test('malformed JSON returns a safe HTTP 400 JSON response', async () => {
    const response = await fetch(registerUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid json',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Request body must contain valid JSON.' });
  });

  await t.test('an unavailable database returns HTTP 500 without exposing internal details', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "User" RENAME TO "User_unavailable"');
    try {
      const response = await register({ ...input, email: 'failure@example.test' });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to register. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "User_unavailable" RENAME TO "User"');
    }
  });
});
