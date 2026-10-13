const crypto = require('node:crypto');

const tokens = new Map();
const attempts = new Map();
const contactAttempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;

function addAttempt(map, key, max, now = Date.now()) {
  const existing = map.get(key) || { count: 0, until: now + WINDOW_MS };
  if (existing.until <= now) { existing.count = 0; existing.until = now + WINDOW_MS; }
  if (existing.count >= max) { map.set(key, existing); return false; }
  existing.count += 1; map.set(key, existing);
  return true;
}
function isValidAdminPassword(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || candidate.length > 256) return false;
  const candidateHash = crypto.createHash('sha256').update(candidate).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}
function createToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + SESSION_MS);
  return token;
}
function cleanExpiredTokens() {
  const now = Date.now();
  for (const [token, expires] of tokens) if (expires <= now) tokens.delete(token);
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
}
function authenticateAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer ([a-f0-9]{64})$/.exec(header);
  const expiration = match ? tokens.get(match[1]) : null;
  if (!expiration || expiration <= Date.now()) {
    if (match) tokens.delete(match[1]);
    return res.status(401).json({ success: false, message: 'Session expirée. Reconnectez-vous.' });
  }
  return next();
}

module.exports = {
  isValidAdminPassword,
  createToken,
  cleanExpiredTokens,
  authenticateAdmin,
  allowLoginAttempt: (ip) => addAttempt(attempts, ip, 6),
  allowContactMessage: (ip) => addAttempt(contactAttempts, ip, 10)
};

