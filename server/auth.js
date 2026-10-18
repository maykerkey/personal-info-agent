import crypto from 'node:crypto';

const TTL_MS = 30 * 24 * 3600 * 1000;

let secretOverride = '';

const getSecret = () => secretOverride || process.env.APP_SECRET || '';

export const authRequired = () => Boolean(process.env.APP_PASSWORD);

export function applyAuthConfig({ secret, password } = {}) {
  if (secret) secretOverride = secret;
  if (password !== undefined) process.env.APP_PASSWORD = String(password);
}

export function issueToken() {
  const exp = Date.now() + TTL_MS;
  const sig = crypto.createHmac('sha256', getSecret()).update(String(exp)).digest('hex');
  return `v1.${exp}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expect = crypto.createHmac('sha256', getSecret()).update(String(exp)).digest('hex');
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function checkPassword(password) {
  return Boolean(process.env.APP_PASSWORD) && String(password) === process.env.APP_PASSWORD;
}

export function authMiddleware(req, res, next) {
  if (!authRequired()) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (verifyToken(token)) return next();
  res.status(401).json({ error: '未登录或登录已过期' });
}
