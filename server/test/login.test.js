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

test('POST /api/auth/login', async (t) => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'scheduler-login-test-'));
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
      || !basename(directory).startsWith('scheduler-login-test-')) {
      throw new Error('Unexpected login test cleanup path.');
    }
    await rm(directory, { recursive: true, force: true });
  });

  // Use an isolated migrated database and a separate test JWT secret.
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = secret;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, RUST_LOG: 'info' },
    stdio: 'pipe',
  });

  ({ default: prisma } = await import('../src/db.js'));
  const { default: app } = await import('../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const authUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  function post(path, body) {
    return fetch(`${authUrl}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const credentials = { email: 'my@example.com', password: '123456' };
  const registered = await post('register', { name: 'Phuong My', ...credentials });
  assert.equal(registered.status, 201);
  const { user } = await registered.json();
  let successfulBody;

  await t.test('correct credentials return HTTP 200 and the registered user', async () => {
    const response = await post('login', credentials);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    successfulBody = await response.json();
    assert.deepEqual(successfulBody.user, { id: user.id, name: 'Phuong My', email: credentials.email });
  });

  await t.test('an unknown email returns HTTP 401 without a token', async () => {
    const response = await post('login', { ...credentials, email: 'unknown@example.com' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid email or password.' });
    assert.equal(await prisma.user.count({ where: { email: 'unknown@example.com' } }), 0);
  });

  await t.test('an incorrect password returns the same HTTP 401 error', async () => {
    const response = await post('login', { ...credentials, password: 'incorrect' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid email or password.' });
  });

  await t.test('email is trimmed and lowercased before looking up the user', async () => {
    const response = await post('login', { ...credentials, email: '  MY@EXAMPLE.COM  ' });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).user, successfulBody.user);
  });

  await t.test('the response contains no password or passwordHash', () => {
    assert.deepEqual(Object.keys(successfulBody).sort(), ['token', 'user']);
    assert.deepEqual(Object.keys(successfulBody.user).sort(), ['email', 'id', 'name']);
    for (const object of [successfulBody, successfulBody.user]) {
      assert.ok(!Object.hasOwn(object, 'password'));
      assert.ok(!Object.hasOwn(object, 'passwordHash'));
    }
  });

  await t.test('successful login creates a JWT signed with the environment secret', () => {
    assert.equal(typeof successfulBody.token, 'string');
    const payload = jwt.verify(successfulBody.token, secret, { algorithms: ['HS256'] });
    assert.equal(payload.userId, user.id);
    assert.equal(jwt.decode(successfulBody.token, { complete: true }).header.alg, 'HS256');
  });

  await t.test('the JWT payload contains only userId and standard time claims', () => {
    const payload = jwt.verify(successfulBody.token, secret, { algorithms: ['HS256'] });
    assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'userId']);
    assert.ok(!Object.hasOwn(payload, 'password'));
    assert.ok(!Object.hasOwn(payload, 'passwordHash'));
    assert.ok(!Object.hasOwn(payload, 'email'));
    assert.ok(!Object.hasOwn(payload, 'name'));
  });

  await t.test('the JWT expires after one day and is rejected at expiration', () => {
    const payload = jwt.verify(successfulBody.token, secret, { algorithms: ['HS256'] });
    assert.equal(payload.exp - payload.iat, 24 * 60 * 60);
    assert.throws(() => jwt.verify(successfulBody.token, secret, {
      algorithms: ['HS256'], clockTimestamp: payload.exp,
    }), { name: 'TokenExpiredError' });
  });

  await t.test('a different secret cannot verify the JWT signature', () => {
    assert.throws(() => jwt.verify(successfulBody.token, randomBytes(32).toString('hex'), {
      algorithms: ['HS256'],
    }), { name: 'JsonWebTokenError' });
  });

  await t.test('a body missing email returns HTTP 400', async () => {
    const response = await post('login', { password: credentials.password });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Email is required.' });
  });

  await t.test('a body missing password returns HTTP 400', async () => {
    const response = await post('login', { email: credentials.email });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Password is required.' });
  });

  await t.test('empty or non-string fields are rejected with HTTP 400', async () => {
    for (const email of ['', '   ', null, 123, {}, []]) {
      const response = await post('login', { ...credentials, email });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Email is required.' });
    }
    for (const password of ['', null, 123456, {}, []]) {
      const response = await post('login', { ...credentials, password });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Password is required.' });
    }
  });

  await t.test('login preserves spaces in the password', async () => {
    const email = 'spaces@example.test';
    const registered = await post('register', { name: 'Spaces', email, password: ' 1234 ' });
    assert.equal(registered.status, 201);
    await registered.json();
    const correct = await post('login', { email, password: ' 1234 ' });
    assert.equal(correct.status, 200);
    await correct.json();
    const trimmed = await post('login', { email, password: '1234' });
    assert.equal(trimmed.status, 401);
    await trimmed.json();
  });

  await t.test('passwords over 72 UTF-8 bytes cannot bypass comparison by truncation', async () => {
    const email = 'maximum@example.test';
    const password = 'a'.repeat(72);
    const registered = await post('register', { name: 'Maximum', email, password });
    assert.equal(registered.status, 201);
    await registered.json();
    const correct = await post('login', { email, password });
    assert.equal(correct.status, 200);
    await correct.json();
    for (const password of ['a'.repeat(72) + 'x', 'é'.repeat(37)]) {
      const response = await post('login', { email, password });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Password must not exceed 72 UTF-8 bytes.' });
    }
  });

  await t.test('a missing or blank JWT_SECRET returns HTTP 500 without a fallback token', async (t) => {
    t.mock.method(console, 'error', () => {});
    try {
      for (const value of [undefined, '', '   ']) {
        if (value === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = value;
        const response = await post('login', credentials);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: 'Unable to log in. Please try again later.' });
      }
    } finally {
      process.env.JWT_SECRET = secret;
    }
  });

  await t.test('an unavailable database returns a safe HTTP 500 response', async (t) => {
    t.mock.method(console, 'error', () => {});
    await prisma.$executeRawUnsafe('ALTER TABLE "User" RENAME TO "User_unavailable"');
    try {
      const response = await post('login', credentials);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to log in. Please try again later.' });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "User_unavailable" RENAME TO "User"');
    }
  });
});
