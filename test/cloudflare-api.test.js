const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { handlePortfolioRequest } = require('../functions/_shared/api.mjs');

const setupToken = 'test-only-setup-token-that-is-long-enough';
const sessionSecret = 'test-only-session-secret-that-is-long-enough';
const siteOrigin = 'https://thibaud-stanislas.github.io';

class D1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  run() {
    const statement = this.database.prepare(this.sql);
    if (/\bRETURNING\b/i.test(this.sql)) {
      const row = statement.get(...this.values);
      return { success: true, meta: { changes: row ? 1 : 0, last_row_id: row?.id } };
    }
    const result = statement.run(...this.values);
    return { success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
  }
}

class D1Database {
  constructor() {
    this.database = new Database(':memory:');
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_initial.sql'), 'utf8');
    this.database.exec(migration);
  }
  prepare(sql) { return new D1Statement(this.database, sql); }
  close() { this.database.close(); }
}

function makeEnv(DB = new D1Database()) {
  return { DB, ADMIN_SETUP_TOKEN: setupToken, SESSION_SECRET: sessionSecret, CORS_ORIGIN: siteOrigin };
}

async function call(env, endpoint, { method = 'GET', body, token, origin = siteOrigin, ip = '192.0.2.10' } = {}) {
  const headers = new Headers({ Origin: origin, 'CF-Connecting-IP': ip });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const request = new Request(`https://portfolio.example${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await handlePortfolioRequest(request, env);
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

async function makeAdmin(env) {
  const result = await call(env, '/api/setup', {
    method: 'POST',
    ip: '192.0.2.11',
    body: { email: 'STANISLAS@example.fr', password: 'phrase-secrete-de-test-2026!', setupToken }
  });
  assert.equal(result.response.status, 201);
}

function nextOpenDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  while ([0, 1].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test('Cloudflare API: first admin setup is guarded and permanently closes after registration', async (t) => {
  const env = makeEnv();
  t.after(() => env.DB.close());
  let result = await call(env, '/api/setup/status');
  assert.deepEqual(result.data, { success: true, configured: false, setupAvailable: true });
  result = await call(env, '/api/setup', { method: 'POST', ip: '192.0.2.20', body: { email: 'owner@example.fr', password: 'phrase-secrete-de-test-2026!', setupToken: 'wrong' } });
  assert.equal(result.response.status, 401);
  await makeAdmin(env);
  result = await call(env, '/api/setup/status');
  assert.deepEqual(result.data, { success: true, configured: true, setupAvailable: false });
  result = await call(env, '/api/setup', { method: 'POST', ip: '192.0.2.21', body: { email: 'second@example.fr', password: 'another-secure-test-password!', setupToken } });
  assert.equal(result.response.status, 409);
});

test('Cloudflare API: login, signed sessions, and protected message management', async (t) => {
  const env = makeEnv();
  t.after(() => env.DB.close());
  await makeAdmin(env);
  let result = await call(env, '/api/login', { method: 'POST', body: { email: 'owner@example.fr', password: 'bad password' } });
  assert.equal(result.response.status, 401);
  result = await call(env, '/api/login', { method: 'POST', body: { email: ' STANISLAS@example.fr ', password: 'phrase-secrete-de-test-2026!' } });
  assert.equal(result.response.status, 200);
  const token = result.data.token;
  assert.ok(token);
  assert.equal((await call(env, '/api/messages')).response.status, 401);
  const [payload, signature] = token.split('.');
  const tamperedToken = `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  assert.equal((await call(env, '/api/messages', { token: tamperedToken })).response.status, 401);
  result = await call(env, '/api/messages', { method: 'POST', body: { name: 'Camille Martin', email: 'CAMILLE@example.fr', message: 'Création d’un site vitrine professionnel.' } });
  assert.equal(result.response.status, 201);
  const messageId = result.data.id;
  result = await call(env, '/api/messages', { token });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].email, 'camille@example.fr');
  assert.equal((await call(env, `/api/messages/${messageId}/read`, { method: 'PATCH', token })).response.status, 200);
  result = await call(env, '/api/messages', { token });
  assert.equal(result.data[0].is_read, 1);
  assert.equal((await call(env, `/api/messages/${messageId}`, { method: 'DELETE', token })).response.status, 200);
  assert.equal((await call(env, '/api/messages', { token })).data.length, 0);
});

test('Cloudflare API: Gmail pairing, queued replies, and incoming email are protected and deduplicated', async (t) => {
  const env = makeEnv();
  t.after(() => env.DB.close());
  await makeAdmin(env);
  const login = await call(env, '/api/login', { method: 'POST', body: { email: 'stanislas@example.fr', password: 'phrase-secrete-de-test-2026!' } });
  const adminToken = login.data.token;

  let result = await call(env, '/api/email/bridge/pairing', { method: 'POST', token: adminToken });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.pairingCode.length, 32);
  assert.equal((await call(env, '/api/email/bridge/pair', { method: 'POST', body: { pairingCode: result.data.pairingCode, accountEmail: 'different@example.fr' } })).response.status, 403);
  const paired = await call(env, '/api/email/bridge/pair', { method: 'POST', body: { pairingCode: result.data.pairingCode, accountEmail: 'stanislas@example.fr' } });
  assert.equal(paired.response.status, 200);
  const bridgeToken = paired.data.token;
  assert.ok(bridgeToken);
  assert.equal((await call(env, '/api/email/bridge/status', { token: adminToken })).data.connected, true);

  const contact = await call(env, '/api/messages', { method: 'POST', body: { name: 'Camille Martin', email: 'camille@example.fr', message: 'J’aimerais créer un site vitrine.' } });
  const messageId = contact.data.id;
  result = await call(env, `/api/messages/${messageId}/replies`, { method: 'POST', token: adminToken, body: { body: 'Bonjour Camille, parlons de votre projet.' } });
  assert.equal(result.response.status, 201);
  const replyId = result.data.replyId;

  result = await call(env, '/api/email/bridge/sync/outbox/claim', { method: 'POST', token: bridgeToken, body: {} });
  assert.equal(result.data.replies.length, 1);
  assert.equal(result.data.replies[0].id, replyId);
  assert.equal(result.data.replies[0].email, 'camille@example.fr');
  result = await call(env, `/api/email/bridge/sync/outbox/${replyId}/sent`, { method: 'POST', token: bridgeToken, body: { gmailThreadId: 'thread-camille-1', gmailMessageId: 'gmail-sent-1' } });
  assert.equal(result.response.status, 200);

  result = await call(env, '/api/email/bridge/sync/conversations', { token: bridgeToken });
  assert.equal(result.data.conversations[0].gmailThreadId, 'thread-camille-1');
  assert.deepEqual(result.data.conversations[0].knownMessageIds, ['gmail-sent-1']);
  const incoming = { messageId, gmailThreadId: 'thread-camille-1', gmailMessageId: 'gmail-in-1', from: 'camille@example.fr', body: 'Merci, je vous réponds demain.', receivedAt: new Date().toISOString() };
  result = await call(env, '/api/email/bridge/sync/incoming', { method: 'POST', token: bridgeToken, body: incoming });
  assert.equal(result.data.received, true);
  result = await call(env, '/api/email/bridge/sync/incoming', { method: 'POST', token: bridgeToken, body: incoming });
  assert.equal(result.data.received, false);
  assert.equal((await call(env, '/api/email/bridge/sync/incoming', { method: 'POST', token: bridgeToken, body: { ...incoming, gmailMessageId: 'gmail-in-2', from: 'intrus@example.fr' } })).response.status, 403);

  result = await call(env, '/api/messages', { token: adminToken });
  assert.equal(result.data[0].is_read, 0);
  assert.equal(result.data[0].is_processed, 0);
  assert.deepEqual(result.data[0].replies.map((reply) => reply.direction), ['outbound', 'inbound']);
  assert.equal(result.data[0].replies[1].body, 'Merci, je vous réponds demain.');

  await call(env, '/api/email/bridge/disconnect', { method: 'POST', token: adminToken, body: {} });
  assert.equal((await call(env, '/api/email/bridge/sync/conversations', { token: bridgeToken })).response.status, 401);
});

test('Cloudflare API: CORS rejects unrelated origins and health reports a working database', async (t) => {
  const env = makeEnv();
  t.after(() => env.DB.close());
  let result = await call(env, '/api/health');
  assert.equal(result.response.status, 200);
  assert.equal(result.data.service, 'portfolio-api');
  env.CORS_ORIGIN = '';
  result = await call(env, '/api/health', { origin: siteOrigin });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), siteOrigin);
  result = await call(env, '/api/health', { origin: 'https://unexpected.example' });
  assert.equal(result.response.status, 403);
  result = await call(env, '/api/health', { method: 'OPTIONS' });
  assert.equal(result.response.status, 204);
  assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), siteOrigin);
});

test('Cloudflare API: Tempo reservations are public, validate dates, expose availability, and enforce capacity', async (t) => {
  const env = makeEnv();
  t.after(() => env.DB.close());
  const date = nextOpenDate();
  let result = await call(env, '/api/bookings/availability?date=not-a-date');
  assert.equal(result.response.status, 400);
  for (let index = 0; index < 8; index += 1) {
    result = await call(env, '/api/bookings', { method: 'POST', ip: `192.0.2.${30 + index}`, body: { name: `Client ${index}`, email: `client${index}@example.fr`, date, time: '09:30', className: 'vinyasa' } });
    assert.equal(result.response.status, 201);
  }
  result = await call(env, '/api/bookings', { method: 'POST', ip: '192.0.2.45', body: { name: 'Client suivant', email: 'suivant@example.fr', date, time: '09:30', className: 'yin' } });
  assert.equal(result.response.status, 409);
  result = await call(env, `/api/bookings/availability?date=${date}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.bookings.length, 8);
  assert.equal((await call(env, '/api/bookings')).response.status, 401);
  await makeAdmin(env);
  result = await call(env, '/api/login', { method: 'POST', body: { email: 'stanislas@example.fr', password: 'phrase-secrete-de-test-2026!' } });
  const adminToken = result.data.token;
  result = await call(env, '/api/bookings', { token: adminToken });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.length, 8);
  assert.equal((await call(env, `/api/bookings/${result.data[0].id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'confirmed' } })).response.status, 200);
});

