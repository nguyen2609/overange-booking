import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { getDatabaseProvider, getFrontendOrigin, getServerConfig } from '../src/config.js';
import { createCorsMiddleware } from '../src/middleware/cors.js';

test('deployment environment configuration', async (t) => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:placeholder@localhost:5432/test',
    JWT_SECRET: 'test-only-placeholder',
    FRONTEND_URL: 'https://casting.example.test',
    PORT: '4321',
  };
  await t.test('SQLite local and both PostgreSQL URL prefixes are supported', () => {
    assert.equal(getDatabaseProvider('file:./dev.db'), 'sqlite');
    assert.equal(getDatabaseProvider(production.DATABASE_URL), 'postgresql');
    assert.equal(getDatabaseProvider('postgres://user:placeholder@localhost/test'), 'postgresql');
  });
  await t.test('development defaults to port 3000 and localhost frontend', () => {
    assert.deepEqual(getServerConfig({ DATABASE_URL: 'file:./dev.db' }), {
      port: 3000, databaseProvider: 'sqlite', frontendOrigin: 'http://localhost:5173',
    });
  });
  await t.test('production reads PORT, DATABASE_URL and FRONTEND_URL', () => {
    assert.deepEqual(getServerConfig(production), {
      port: 4321, databaseProvider: 'postgresql', frontendOrigin: production.FRONTEND_URL,
    });
  });
  await t.test('invalid ports are rejected without disclosing other env values', () => {
    for (const PORT of ['', 'abc', '0', '-1', '65536', '3.14']) {
      assert.throws(() => getServerConfig({ ...production, PORT }), /PORT must be an integer/);
    }
  });
  await t.test('missing or unsupported DATABASE_URL is rejected', () => {
    for (const DATABASE_URL of [undefined, '', 'mysql://host/test']) {
      assert.throws(() => getServerConfig({ ...production, DATABASE_URL }), /DATABASE_URL must/);
    }
  });
  await t.test('production rejects SQLite', () => {
    assert.throws(() => getServerConfig({ ...production, DATABASE_URL: 'file:./dev.db' }), /Production requires/);
  });
  await t.test('production requires JWT_SECRET', () => {
    for (const JWT_SECRET of [undefined, '', '   ']) {
      assert.throws(() => getServerConfig({ ...production, JWT_SECRET }), /JWT_SECRET is required/);
    }
  });
  await t.test('production requires a valid HTTPS frontend origin', () => {
    for (const FRONTEND_URL of [undefined, '', '*', 'http://casting.example.test', 'https://casting.example.test/path',
      'https://user:secret@casting.example.test', 'https://casting.example.test?query=1', 'https://casting.example.test#hash']) {
      assert.throws(() => getServerConfig({ ...production, FRONTEND_URL }), /FRONTEND_URL must/);
    }
  });
  await t.test('a trailing slash is normalized without weakening origin matching', () => {
    assert.equal(getFrontendOrigin('https://casting.example.test/', true), 'https://casting.example.test');
  });
});

test('development and production CORS', async (t) => {
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  });
  async function start(environment) {
    const app = express();
    app.use(createCorsMiddleware(environment));
    app.get('/health', (req, res) => res.json({ status: 'ok' }));
    app.post('/probe', (req, res) => res.status(201).json({ handled: true }));
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    return 'http://127.0.0.1:' + server.address().port;
  }
  const local = await start({});
  const production = await start({ NODE_ENV: 'production', FRONTEND_URL: 'https://casting.example.test/' });
  await t.test('development permits localhost:5173', async () => {
    const response = await fetch(local + '/health', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
  await t.test('development also permits the loopback IP', async () => {
    const response = await fetch(local + '/health', { headers: { Origin: 'http://127.0.0.1:5173' } });
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
  });
  await t.test('production permits exactly the configured frontend', async () => {
    const response = await fetch(production + '/health', { headers: { Origin: 'https://casting.example.test' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://casting.example.test');
    assert.match(response.headers.get('vary'), /Origin/);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  });
  await t.test('production rejects localhost, unknown and lookalike domains before route handling', async () => {
    for (const Origin of ['http://localhost:5173', 'https://other.example.test', 'https://casting.example.test.attacker.test', 'null']) {
      const response = await fetch(production + '/probe', { method: 'POST', headers: { Origin } });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.deepEqual(await response.json(), { error: 'Origin is not allowed.' });
    }
  });
  await t.test('preflight supports JWT Authorization and JSON POST', async () => {
    const response = await fetch(production + '/probe', { method: 'OPTIONS', headers: {
      Origin: 'https://casting.example.test', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://casting.example.test');
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/i);
    assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/i);
  });
  await t.test('preflight supports authenticated DELETE for cancellation', async () => {
    const response = await fetch(production + '/bookings/1', { method: 'OPTIONS', headers: {
      Origin: 'https://casting.example.test', 'Access-Control-Request-Method': 'DELETE',
      'Access-Control-Request-Headers': 'authorization',
    } });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods'), /DELETE/);
  });
  await t.test('unknown origins cannot preflight', async () => {
    const response = await fetch(production + '/probe', { method: 'OPTIONS', headers: { Origin: 'https://other.example.test' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
  await t.test('health checks and PowerShell without Origin still work', async () => {
    const response = await fetch(production + '/health');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

