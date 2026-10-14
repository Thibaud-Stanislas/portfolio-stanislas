const express = require('express');
const cors = require('cors');
const db = require('./database');
const {
  createToken, isValidAdminPassword, cleanExpiredTokens, authenticateAdmin,
  allowLoginAttempt, allowContactMessage
} = require('./security');

const app = express();
const port = Number(process.env.PORT) || 4173;
const staticRoot = __dirname;

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (allowedOrigins.length) {
  app.use(cors({ origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); }, allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
}
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '24kb' }));

function responseError(res, status, message) { return res.status(status).json({ success: false, message }); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function safeId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
function authorize(req, res, next) { cleanExpiredTokens(); return authenticateAdmin(req, res, next); }

app.get('/api/health', (req, res) => res.json({ success: true, service: 'portfolio-api' }));

app.post('/api/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowLoginAttempt(ip)) return responseError(res, 429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changez-moi-avec-un-secret-long-de-32-caracteres') {
    return responseError(res, 503, 'L’accès administrateur n’est pas encore configuré sur le serveur.');
  }
  if (!isValidAdminPassword(password, process.env.ADMIN_PASSWORD)) return responseError(res, 401, 'Mot de passe incorrect.');
  return res.json({ success: true, token: createToken() });
});

app.post('/api/messages', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowContactMessage(ip)) return responseError(res, 429, 'Trop de messages ont été envoyés. Réessayez plus tard.');
  const { name, email, message } = req.body || {};
  if ([name, email, message].some((value) => typeof value !== 'string' || !value.trim())) return responseError(res, 400, 'Tous les champs sont obligatoires.');
  const clean = { name: name.trim(), email: email.trim().toLowerCase(), message: message.trim() };
  if (clean.name.length > 100 || clean.email.length > 254 || clean.message.length > 5000 || !validEmail(clean.email)) return responseError(res, 400, 'Vérifiez les informations de votre message.');
  const result = db.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)').run(clean.name, clean.email, clean.message);
  return res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Votre message a bien été envoyé.' });
});

app.get('/api/messages', authorize, (req, res) => {
  const messages = db.prepare('SELECT id, name, email, message, created_at, is_read, is_processed FROM messages ORDER BY created_at DESC, id DESC').all();
  return res.json(messages);
});

app.patch('/api/messages/:id/:action', authorize, (req, res) => {
  const id = safeId(req.params.id);
  const columns = { read: ['is_read', 1], unread: ['is_read', 0], processed: ['is_processed', 1], unprocessed: ['is_processed', 0] };
  const update = columns[req.params.action];
  if (!id || !update) return responseError(res, 400, 'Action ou identifiant invalide.');
  const result = db.prepare(`UPDATE messages SET ${update[0]} = ? WHERE id = ?`).run(update[1], id);
  if (!result.changes) return responseError(res, 404, 'Message introuvable.');
  return res.json({ success: true });
});

app.delete('/api/messages/:id', authorize, (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return responseError(res, 400, 'Identifiant invalide.');
  const result = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  if (!result.changes) return responseError(res, 404, 'Message introuvable.');
  return res.json({ success: true });
});

const sessionSlots = ['09:30', '11:00', '14:30', '16:00'];
const sessionNames = new Set(['vinyasa', 'yin', 'respiration']);
const dayBookings = db.prepare("SELECT time, COUNT(*) AS count FROM bookings WHERE date = ? AND status != 'refused' GROUP BY time");
app.get('/api/bookings/availability', (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00`))) return responseError(res, 400, 'Date invalide.');
  const bookedCounts = new Map(dayBookings.all(date).map((row) => [row.time, row.count]));
  return res.json({ success: true, date, bookings: sessionSlots.flatMap((time) => Array.from({ length: bookedCounts.get(time) || 0 }, (_, index) => ({ time, index }))) });
});

app.post('/api/bookings', (req, res) => {
  const { name, email, date, time, className } = req.body || {};
  if ([name, email, date, time, className].some((value) => typeof value !== 'string' || !value.trim())) return responseError(res, 400, 'Complétez les champs requis pour réserver.');
  const cleanName = name.trim(); const cleanEmail = email.trim().toLowerCase();
  if (cleanName.length > 100 || cleanEmail.length > 254 || !validEmail(cleanEmail) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !sessionSlots.includes(time) || !sessionNames.has(className)) return responseError(res, 400, 'Vérifiez les informations de réservation.');
  const pickedDate = new Date(`${date}T12:00:00`); const today = new Date(); today.setHours(0, 0, 0, 0);
  if (Number.isNaN(pickedDate.getTime()) || pickedDate < today || [0, 1].includes(pickedDate.getDay())) return responseError(res, 400, 'Choisissez un jour d’ouverture à partir d’aujourd’hui.');
  const reserve = db.transaction(() => {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE date = ? AND time = ? AND status != 'refused'").get(date, time);
    if (count >= 8) return null;
    const result = db.prepare('INSERT INTO bookings (name, email, date, time, class_name) VALUES (?, ?, ?, ?, ?)').run(cleanName, cleanEmail, date, time, className);
    return result.lastInsertRowid;
  });
  const bookingId = reserve();
  if (!bookingId) return responseError(res, 409, 'Ce créneau est complet. Choisissez-en un autre.');
  return res.status(201).json({ success: true, id: bookingId, message: 'Demande enregistrée.' });
});

app.get('/api/bookings', authorize, (req, res) => {
  const items = db.prepare('SELECT id, name, email, date, time, class_name, created_at, status FROM bookings ORDER BY date ASC, time ASC, id ASC').all();
  return res.json(items);
});

app.patch('/api/bookings/:id/status', authorize, (req, res) => {
  const id = safeId(req.params.id); const { status } = req.body || {};
  if (!id || !['pending', 'confirmed', 'refused'].includes(status)) return responseError(res, 400, 'Statut ou identifiant invalide.');
  const result = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
  if (!result.changes) return responseError(res, 404, 'Réservation introuvable.');
  return res.json({ success: true });
});

app.delete('/api/bookings/:id', authorize, (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return responseError(res, 400, 'Identifiant invalide.');
  const result = db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  if (!result.changes) return responseError(res, 404, 'Réservation introuvable.');
  return res.json({ success: true });
});

app.use(express.static(staticRoot, { extensions: ['html'], dotfiles: 'ignore', index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use((req, res) => res.status(404).json({ success: false, message: 'Page introuvable.' }));

if (require.main === module) app.listen(port, '0.0.0.0', () => console.log(`Portfolio prêt sur http://localhost:${port}`));

module.exports = app;
