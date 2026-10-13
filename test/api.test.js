const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-api-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'mot-de-passe-test-avec-assez-de-longueur';
const db = require('../database');
const app = require('../server');
let server;
let baseUrl;
let adminToken;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}), ...options.headers }
  });
  let data = {};
  try { data = await response.json(); } catch { /* réponse volontairement vide */ }
  return { response, data };
}

test('health check and protected admin login', async () => {
  const health = await json('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.success, true);
  assert.equal((await json('/api/messages')).response.status, 401);
  const wrong = await json('/api/login', { method: 'POST', body: JSON.stringify({ password: 'incorrect' }) });
  assert.equal(wrong.response.status, 401);
  const login = await json('/api/login', { method: 'POST', body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  assert.equal(login.response.status, 200);
  assert.match(login.data.token, /^[a-f0-9]{64}$/);
  adminToken = login.data.token;
});

test('contact messages validate, persist, change status and delete', async () => {
  const missing = await json('/api/messages', { method: 'POST', body: JSON.stringify({ name: 'Lucie', email: 'lucie@example.fr' }) });
  assert.equal(missing.response.status, 400);
  const created = await json('/api/messages', { method: 'POST', body: JSON.stringify({ name: 'Lucie Martin', email: 'lucie@example.fr', message: 'Bonjour, parlons de mon site.' }) });
  assert.equal(created.response.status, 201);
  const list = await json('/api/messages');
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].is_processed, 0);
  const processed = await json(`/api/messages/${list.data[0].id}/processed`, { method: 'PATCH' });
  assert.equal(processed.response.status, 200);
  const read = await json(`/api/messages/${list.data[0].id}/read`, { method: 'PATCH' });
  assert.equal(read.response.status, 200);
  const refreshed = await json('/api/messages');
  assert.equal(refreshed.data[0].is_processed, 1);
  assert.equal(refreshed.data[0].is_read, 1);
  const deleted = await json(`/api/messages/${list.data[0].id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  assert.equal((await json('/api/messages')).data.length, 0);
});

test('Tempo reservations enforce dates, required fields and session capacity', async () => {
  const invalid = await json('/api/bookings', { method: 'POST', body: JSON.stringify({ name: 'Noémie', email: 'noemie@example.fr', date: '2020-01-01', time: '09:30', className: 'tournage' }) });
  assert.equal(invalid.response.status, 400);
  const date = new Date();
  while ([0, 1].includes(date.getDay())) date.setDate(date.getDate() + 1);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 8; i += 1) {
    const last = await json('/api/bookings', { method: 'POST', body: JSON.stringify({ name: `Noémie ${i}`, email: `noemie${i}@example.fr`, date: iso, time: '09:30', className: 'tournage' }) });
    assert.equal(last.response.status, 201);
  }
  const full = await json('/api/bookings', { method: 'POST', body: JSON.stringify({ name: 'Camille', email: 'camille@example.fr', date: iso, time: '09:30', className: 'modelage' }) });
  assert.equal(full.response.status, 409);
  const availability = await json(`/api/bookings/availability?date=${iso}`);
  assert.equal(availability.data.bookings.length, 8);
  const protectedList = await json('/api/bookings');
  assert.equal(protectedList.response.status, 200);
  assert.equal(protectedList.data.length, 8);
});

