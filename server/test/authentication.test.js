import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

test('authentication middleware and GET /api/auth/me', async (t) => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'scheduler-auth-test-'));
  const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSecret = process.env.JWT_SECRET;
  const secret = randomBytes(32).toString('hex');
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
      || !basename(directory).startsWith('scheduler-auth-test-')) {
      throw new Error('Unexpected authentication test cleanup path.');
    }
    await rm(directory, { recursive: true, force: true });
  });

  // Every account and token used below belongs to this temporary database.
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = secret;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, RUST_LOG: 'info' },
    stdio: 'pipe',
  });

  ({ default: prisma } = await import('../src/db.js'));
  const { default: app } = await import('../src/app.js');
  const { default: authenticate } = await import('../src/middleware/authenticate.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const authUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  async function createSession(name, email) {
    const body = { name, email, password: '123456' };
    const registered = await fetch(`${authUrl}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(registered.status, 201);
    await registered.json();
    const login = await fetch(`${authUrl}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(login.status, 200);
    return login.json();
  }

  function me(authorization) {
    return fetch(`${authUrl}/me`, {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    });
  }

  async function expectUnauthorized(authorization) {
    const response = await me(authorization);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
  }

  const my = await createSession('Phuong My', 'my@example.com');
  const anna = await createSession('Anna', 'anna@example.com');

  await t.test('a valid Login token returns HTTP 200 with the current user', async () => {
    const response = await me(`Bearer ${my.token}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), my.user);
  });

  await t.test('a missing Authorization header returns HTTP 401', async () => {
    await expectUnauthorized(undefined);
  });

  await t.test('incorrect Bearer header formats return HTTP 401', async () => {
    for (const header of ['', 'Bearer', 'Bearer ', `Basic ${my.token}`, my.token,
      `Bearer ${my.token} extra`, `Bearer ${my.token},${anna.token}`]) {
      await expectUnauthorized(header);
    }
  });

  await t.test('malformed and invalidly signed tokens return HTTP 401', async () => {
    const wrongSecretToken = jwt.sign({ userId: my.user.id }, randomBytes(32).toString('hex'), {
      algorithm: 'HS256', expiresIn: '1d',
    });
    await expectUnauthorized('Bearer not-a-jwt');
    await expectUnauthorized(`Bearer ${wrongSecretToken}`);
  });

  await t.test('an expired token returns HTTP 401', async () => {
    const token = jwt.sign({ userId: my.user.id }, secret, { algorithm: 'HS256', expiresIn: -1 });
    await expectUnauthorized(`Bearer ${token}`);
  });

  await t.test('a valid token for a deleted user returns HTTP 401', async () => {
    const deleted = await createSession('Deleted', 'deleted@example.test');
    await prisma.user.delete({ where: { id: deleted.user.id } });
    await expectUnauthorized(`Bearer ${deleted.token}`);
  });

  await t.test('the response contains neither password nor passwordHash', async () => {
    const response = await me(`Bearer ${my.token}`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['email', 'id', 'name']);
    assert.ok(!Object.hasOwn(body, 'passwordHash'));
    assert.ok(!Object.hasOwn(body, 'password'));
  });

  await t.test('the middleware attaches the correct safe user to req.user', async () => {
    for (const session of [my, anna]) {
      const req = { get: (header) => header === 'Authorization' ? `Bearer ${session.token}` : undefined };
      const res = { status: () => { assert.fail('Valid authentication should call next().'); } };
      let nextCalled = false;
      await authenticate(req, res, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
      assert.deepEqual(req.user, session.user);
      assert.deepEqual(Object.keys(req.user).sort(), ['email', 'id', 'name']);
      assert.ok(!Object.hasOwn(req.user, 'passwordHash'));
    }
  });

  await t.test('each token identifies its own user and ignores a supplied query userId', async () => {
    const response = await fetch(`${authUrl}/me?userId=${anna.user.id}`, {
      headers: { Authorization: `Bearer ${my.token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), my.user);
    const annaResponse = await me(`Bearer ${anna.token}`);
    assert.deepEqual(await annaResponse.json(), anna.user);
  });

  await t.test('current user information is read from SQLite on each request', async () => {
    await prisma.user.update({ where: { id: my.user.id }, data: { name: 'Updated My' } });
    try {
      const response = await me(`Bearer ${my.token}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ...my.user, name: 'Updated My' });
    } finally {
      await prisma.user.update({ where: { id: my.user.id }, data: { name: my.user.name } });
    }
  });

  await t.test('invalid userId payloads return HTTP 401 rather than database errors', async () => {
    for (const userId of [undefined, '1', 0, -1, 1.5, 2147483648]) {
      const token = jwt.sign(userId === undefined ? {} : { userId }, secret, {
        algorithm: 'HS256', expiresIn: '1d',
      });
      await expectUnauthorized(`Bearer ${token}`);
    }
  });

  await t.test('unsigned tokens and unexpected algorithms are rejected', async () => {
    const unsigned = jwt.sign({ userId: my.user.id }, null, { algorithm: 'none', expiresIn: '1d' });
    const wrongAlgorithm = jwt.sign({ userId: my.user.id }, secret, { algorithm: 'HS384', expiresIn: '1d' });
    await expectUnauthorized(`Bearer ${unsigned}`);
    await expectUnauthorized(`Bearer ${wrongAlgorithm}`);
  });

  await t.test('a missing JWT secret returns a generic HTTP 500 without exposing secrets', async (t) => {
    t.mock.method(console, 'error', () => {});
    delete process.env.JWT_SECRET;
    try {
      const response = await me(`Bearer ${my.token}`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to authenticate. Please try again later.' });
    } finally {
      process.env.JWT_SECRET = secret;
    }
  });

  await t.test('database failures return a generic HTTP 500', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "User" RENAME TO "User_unavailable"');
    try {
      const response = await me(`Bearer ${my.token}`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to authenticate. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "User_unavailable" RENAME TO "User"');
    }
  });
});
