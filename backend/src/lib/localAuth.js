const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET = process.env.AUTH_SECRET || 'dev-auth-secret-change-me';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
}

function readUsers() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!password || !salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  if (check.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function publicUser(user) {
  return { uid: user.uid, email: user.email, displayName: user.displayName };
}

function findUserByEmail(email) {
  const key = normalizeEmail(email);
  return readUsers().find((u) => u.email === key) || null;
}

function createLocalUser({ email, password, displayName }) {
  const users = readUsers();
  const key = normalizeEmail(email);
  if (!key) {
    const err = new Error('Email is required');
    err.code = 'INVALID';
    throw err;
  }
  if (users.some((u) => u.email === key)) {
    const err = new Error('Email already exists');
    err.code = 'EMAIL_EXISTS';
    throw err;
  }
  const { salt, hash } = hashPassword(password);
  const user = {
    uid: crypto.randomUUID(),
    email: key,
    displayName: displayName || key.split('@')[0],
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  return user;
}

function updateLocalPassword(email, newPassword) {
  const users = readUsers();
  const key = normalizeEmail(email);
  const idx = users.findIndex((u) => u.email === key);
  if (idx < 0) return null;
  const { salt, hash } = hashPassword(newPassword);
  users[idx] = { ...users[idx], salt, hash, otp: null, otpExpiresAt: null };
  writeUsers(users);
  return users[idx];
}

function setOtp(email, otp, expiresAt) {
  const users = readUsers();
  const key = normalizeEmail(email);
  const idx = users.findIndex((u) => u.email === key);
  if (idx < 0) return null;
  users[idx] = { ...users[idx], otp, otpExpiresAt: expiresAt };
  writeUsers(users);
  return users[idx];
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.uid,
    email: user.email,
    exp: Date.now() + TTL_MS,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyLocalToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.exp || Date.now() > data.exp) return null;
    return { uid: data.uid, email: data.email };
  } catch {
    return null;
  }
}

module.exports = {
  findUserByEmail,
  createLocalUser,
  updateLocalPassword,
  setOtp,
  verifyPassword,
  signToken,
  verifyLocalToken,
  publicUser,
  normalizeEmail,
};
