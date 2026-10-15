const encoder = new TextEncoder();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const SESSION_SLOTS = ['09:30', '11:00', '14:30', '16:00'];
const SESSION_NAMES = new Set(['vinyasa', 'yin', 'respiration']);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function error(status, message) {
  return json({ success: false, message }, status);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function constantTimeEqual(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function originIsAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;
  const configured = (env.CORS_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean);
  return configured.includes(origin);
}

function withSecurityHeaders(request, env, response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const origin = request.headers.get('Origin');
  if (origin && originIsAllowed(request, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Max-Age', '600');
    headers.append('Vary', 'Origin');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 24 * 1024) return { error: error(413, 'Le formulaire est trop volumineux.') };
  try {
    const text = await request.text();
    if (text.length > 24 * 1024) return { error: error(413, 'Le formulaire est trop volumineux.') };
    return { body: text ? JSON.parse(text) : {} };
  } catch {
    return { error: error(400, 'Le contenu du formulaire est invalide.') };
  }
}

function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function safeId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

function parisDateParts(now = new Date()) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  return Object.fromEntries(values.map(({ type, value }) => [type, value]));
}

function dateIsValid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function accountExists(db) {
  return Boolean(await db.prepare('SELECT id FROM admin_accounts WHERE id = 1').first());
}

async function clientSubject(request, secret) {
  const address = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}:${address}`));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function allowAttempt(db, request, secret, scope, limit) {
  const subject = await clientSubject(request, secret);
  const now = Date.now();
  const resetAt = now + RATE_WINDOW_MS;
  await db.prepare(`
    INSERT INTO rate_limits (scope, subject, attempts, reset_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(scope, subject) DO UPDATE SET
      attempts = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.attempts + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
  `).bind(scope, subject, resetAt, now, now, resetAt).run();
  const record = await db.prepare('SELECT attempts, reset_at FROM rate_limits WHERE scope = ? AND subject = ?').bind(scope, subject).first();
  return record && record.attempts <= limit;
}

async function createSession(email, secret) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    email, expiresAt: Date.now() + SESSION_TTL_MS, nonce: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  })));
  const signature = bytesToBase64Url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

async function authenticate(request, secret) {
  if (!secret) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
  if (!match) return null;
  try {
    const supplied = base64UrlToBytes(match[2]);
    const expected = await hmac(secret, match[1]);
    if (supplied.length !== expected.length) return null;
    let mismatch = 0;
    for (let index = 0; index < expected.length; index += 1) mismatch |= supplied[index] ^ expected[index];
    if (mismatch !== 0) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(match[1])));
    return typeof payload.email === 'string' && payload.expiresAt > Date.now() ? payload.email : null;
  } catch {
    return null;
  }
}

async function setupStatus(db, env) {
  const configured = await accountExists(db);
  return json({ success: true, configured, setupAvailable: !configured && Boolean(env.ADMIN_SETUP_TOKEN) });
}

async function createAdmin(request, env) {
  if ((env.ADMIN_SETUP_TOKEN || '').length < 32 || (env.SESSION_SECRET || '').length < 32) return error(503, 'La création du compte admin n’est pas encore configurée.');
  if (!await allowAttempt(env.DB, request, env.SESSION_SECRET, 'setup', 6)) return error(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  const parsed = await readBody(request);
  if (parsed.error) return parsed.error;
  const { email, password, setupToken } = parsed.body || {};
  if ([email, password, setupToken].some((value) => typeof value !== 'string')) return error(400, 'Complétez tous les champs.');
  const cleanEmail = email.trim().toLowerCase();
  if (!validEmail(cleanEmail) || cleanEmail.length > 254 || password.length < 14 || password.length > 256) {
    return error(400, 'Saisissez une adresse valide et un mot de passe d’au moins 14 caractères.');
  }
  if (!constantTimeEqual(setupToken, env.ADMIN_SETUP_TOKEN)) return error(401, 'Le code de création est incorrect.');
  const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = bytesToBase64Url(await hmac(env.SESSION_SECRET, `${salt}\0${password}`));
  const result = await env.DB.prepare(`
    INSERT INTO admin_accounts (id, email, password_hash, password_salt)
    SELECT 1, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_accounts)
  `).bind(cleanEmail, passwordHash, salt).run();
  if (!result.meta?.changes) return error(409, 'Le compte administrateur a déjà été créé.');
  return json({ success: true, message: 'Votre compte administrateur est créé. Vous pouvez vous connecter.' }, 201);
}

async function login(request, env) {
  if ((env.SESSION_SECRET || '').length < 32) return error(503, 'La connexion admin n’est pas encore configurée.');
  if (!await allowAttempt(env.DB, request, env.SESSION_SECRET, 'login', 6)) return error(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  const parsed = await readBody(request);
  if (parsed.error) return parsed.error;
  const { email, password } = parsed.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || password.length > 256) return error(400, 'Saisissez votre adresse e-mail et votre mot de passe.');
  const cleanEmail = email.trim().toLowerCase();
  const account = await env.DB.prepare('SELECT email, password_hash, password_salt FROM admin_accounts WHERE id = 1 AND email = ?').bind(cleanEmail).first();
  const salt = account?.password_salt || 'compte-inexistant';
  const expected = account?.password_hash || bytesToBase64Url(await hmac(env.SESSION_SECRET, `${salt}\0password-invalide`));
  const candidate = bytesToBase64Url(await hmac(env.SESSION_SECRET, `${salt}\0${password}`));
  if (!account || !constantTimeEqual(candidate, expected)) return error(401, 'Adresse e-mail ou mot de passe incorrect.');
  const subject = await clientSubject(request, env.SESSION_SECRET);
  await env.DB.prepare('DELETE FROM rate_limits WHERE scope = ? AND subject = ?').bind('login', subject).run();
  return json({ success: true, token: await createSession(cleanEmail, env.SESSION_SECRET) });
}

async function contact(request, env) {
  if (!await allowAttempt(env.DB, request, env.SESSION_SECRET, 'contact', 10)) return error(429, 'Trop de messages ont été envoyés. Réessayez plus tard.');
  const parsed = await readBody(request);
  if (parsed.error) return parsed.error;
  const { name, email, message } = parsed.body || {};
  if ([name, email, message].some((value) => typeof value !== 'string' || !value.trim())) return error(400, 'Tous les champs sont obligatoires.');
  const clean = { name: name.trim(), email: email.trim().toLowerCase(), message: message.trim() };
  if (clean.name.length > 100 || clean.email.length > 254 || clean.message.length > 5000 || !validEmail(clean.email)) return error(400, 'Vérifiez les informations de votre message.');
  const result = await env.DB.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)').bind(clean.name, clean.email, clean.message).run();
  return json({ success: true, id: result.meta?.last_row_id, message: 'Votre message a bien été envoyé.' }, 201);
}

async function createBooking(request, env) {
  const parsed = await readBody(request);
  if (parsed.error) return parsed.error;
  const { name, email: address, date, time, className } = parsed.body || {};
  if ([name, address, date, time, className].some((value) => typeof value !== 'string' || !value.trim())) return error(400, 'Complétez les champs requis pour réserver.');
  const cleanName = name.trim(); const cleanEmail = address.trim().toLowerCase();
  if (cleanName.length > 100 || cleanEmail.length > 254 || !validEmail(cleanEmail) || !dateIsValid(date) || !SESSION_SLOTS.includes(time) || !SESSION_NAMES.has(className)) return error(400, 'Vérifiez les informations de réservation.');
  const parts = parisDateParts();
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  if (date < today || [0, 1].includes(weekday)) return error(400, 'Choisissez un jour d’ouverture à partir d’aujourd’hui.');
  const result = await env.DB.prepare(`
    INSERT INTO bookings (name, email, date, time, class_name)
    SELECT ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM bookings WHERE date = ? AND time = ? AND status != 'refused') < 8
    RETURNING id
  `).bind(cleanName, cleanEmail, date, time, className, date, time).first();
  if (!result) return error(409, 'Ce créneau est complet. Choisissez-en un autre.');
  return json({ success: true, id: result.id, message: 'Demande enregistrée.' }, 201);
}

async function route(request, env) {
  const { pathname, searchParams } = new URL(request.url);
  const method = request.method.toUpperCase();
  if (!env.DB) return error(503, 'La base de données du portfolio n’est pas connectée.');

  if (pathname === '/api/health' && method === 'GET') {
    await env.DB.prepare('SELECT 1 AS ok').first();
    return json({ success: true, service: 'portfolio-api' });
  }
  if (pathname === '/api/setup/status' && method === 'GET') return setupStatus(env.DB, env);
  if (pathname === '/api/setup' && method === 'POST') return createAdmin(request, env);
  if (pathname === '/api/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/messages' && method === 'POST') return contact(request, env);
  if (pathname === '/api/bookings' && method === 'POST') return createBooking(request, env);

  if (pathname === '/api/bookings/availability' && method === 'GET') {
    const date = searchParams.get('date') || '';
    if (!dateIsValid(date)) return error(400, 'Date invalide.');
    const rows = await env.DB.prepare("SELECT time, COUNT(*) AS count FROM bookings WHERE date = ? AND status != 'refused' GROUP BY time").bind(date).all();
    const booked = new Map((rows.results || []).map((row) => [row.time, row.count]));
    return json({ success: true, date, bookings: SESSION_SLOTS.flatMap((time) => Array.from({ length: booked.get(time) || 0 }, (_, index) => ({ time, index }))) });
  }

  const email = await authenticate(request, env.SESSION_SECRET);
  if (!email) return error(401, 'Session expirée. Reconnectez-vous.');

  if (pathname === '/api/messages' && method === 'GET') {
    const messages = await env.DB.prepare('SELECT id, name, email, message, created_at, is_read, is_processed FROM messages ORDER BY created_at DESC, id DESC').all();
    return json(messages.results || []);
  }
  let match = /^\/api\/messages\/(\d+)\/(read|unread|processed|unprocessed)$/.exec(pathname);
  if (match && method === 'PATCH') {
    const columns = { read: ['is_read', 1], unread: ['is_read', 0], processed: ['is_processed', 1], unprocessed: ['is_processed', 0] };
    const [column, value] = columns[match[2]];
    const result = await env.DB.prepare(`UPDATE messages SET ${column} = ? WHERE id = ?`).bind(value, Number(match[1])).run();
    if (!result.meta?.changes) return error(404, 'Message introuvable.');
    return json({ success: true });
  }
  match = /^\/api\/messages\/(\d+)$/.exec(pathname);
  if (match && method === 'DELETE') {
    const id = safeId(match[1]);
    if (!id) return error(400, 'Identifiant invalide.');
    const result = await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
    if (!result.meta?.changes) return error(404, 'Message introuvable.');
    return json({ success: true });
  }
  if (pathname === '/api/bookings' && method === 'GET') {
    const items = await env.DB.prepare('SELECT id, name, email, date, time, class_name, created_at, status FROM bookings ORDER BY date ASC, time ASC, id ASC').all();
    return json(items.results || []);
  }
  match = /^\/api\/bookings\/(\d+)\/status$/.exec(pathname);
  if (match && method === 'PATCH') {
    const parsed = await readBody(request);
    if (parsed.error) return parsed.error;
    const id = safeId(match[1]); const { status } = parsed.body || {};
    if (!id || !['pending', 'confirmed', 'refused'].includes(status)) return error(400, 'Statut ou identifiant invalide.');
    const result = await env.DB.prepare('UPDATE bookings SET status = ? WHERE id = ?').bind(status, id).run();
    if (!result.meta?.changes) return error(404, 'Réservation introuvable.');
    return json({ success: true });
  }
  match = /^\/api\/bookings\/(\d+)$/.exec(pathname);
  if (match && method === 'DELETE') {
    const id = safeId(match[1]);
    if (!id) return error(400, 'Identifiant invalide.');
    const result = await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run();
    if (!result.meta?.changes) return error(404, 'Réservation introuvable.');
    return json({ success: true });
  }

  return error(404, 'Page introuvable.');
}

export async function handlePortfolioRequest(request, env = {}) {
  if (!originIsAllowed(request, env)) return withSecurityHeaders(request, env, error(403, 'Origine non autorisée.'));
  if (request.method.toUpperCase() === 'OPTIONS') return withSecurityHeaders(request, env, new Response(null, { status: 204 }));
  try {
    return withSecurityHeaders(request, env, await route(request, env));
  } catch {
    return withSecurityHeaders(request, env, error(500, 'Une erreur est survenue. Réessayez plus tard.'));
  }
}
