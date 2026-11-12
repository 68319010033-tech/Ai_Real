const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, isFirebaseReady } = require('../config/firebase');

const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET = process.env.AUTH_SECRET || 'dev-auth-secret-change-me';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ถ้า Firebase พร้อม -> เก็บผู้ใช้ใน Realtime Database (ถาวร ไม่หายตอน deploy)
// ถ้าไม่พร้อม (เช่นรันในเครื่อง) -> ใช้ไฟล์ users.json เหมือนเดิม
function useFirebase() {
  return !!(isFirebaseReady && db);
}

// key ใน RTDB ห้ามมี . $ # [ ] / จึงแปลงอีเมลเป็น base64url
console.log(`[auth] user store: ${useFirebase() ? 'Firebase Realtime Database (ถาวร)' : 'ไฟล์ users.json (หายตอน deploy!)'}`);

function userRef(emailKey) {
  return db.ref(`authUsers/${Buffer.from(emailKey).toString('base64url')}`);
}

/* ---------- ที่เก็บแบบไฟล์ (สำรองสำหรับ local) ---------- */
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

/* ---------- helper ---------- */
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

/* ---------- งานกับผู้ใช้ (ทุกตัวเป็น async) ---------- */
async function findUserByEmail(email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  if (useFirebase()) {
    const snap = await userRef(key).once('value');
    return snap.val() || null;
  }
  return readUsers().find((u) => u.email === key) || null;
}

async function createLocalUser({ email, password, displayName }) {
  const key = normalizeEmail(email);
  if (!key) {
    const err = new Error('Email is required');
    err.code = 'INVALID';
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

  if (useFirebase()) {
    // transaction: สร้างได้ก็ต่อเมื่อยังไม่มีอีเมลนี้ (กันสมัครซ้ำพร้อมกัน)
    const result = await userRef(key).transaction((current) => (current ? undefined : user));
    if (!result.committed) {
      const err = new Error('Email already exists');
      err.code = 'EMAIL_EXISTS';
      throw err;
    }
    return user;
  }

  const users = readUsers();
  if (users.some((u) => u.email === key)) {
    const err = new Error('Email already exists');
    err.code = 'EMAIL_EXISTS';
    throw err;
  }
  users.push(user);
  writeUsers(users);
  return user;
}

async function updateLocalPassword(email, newPassword) {
  const key = normalizeEmail(email);
  const existing = await findUserByEmail(key);
  if (!existing) return null;
  const { salt, hash } = hashPassword(newPassword);
  const updated = { ...existing, salt, hash, otp: null, otpExpiresAt: null };

  if (useFirebase()) {
    await userRef(key).update({ salt, hash, otp: null, otpExpiresAt: null });
    return updated;
  }
  const users = readUsers();
  const idx = users.findIndex((u) => u.email === key);
  if (idx < 0) return null;
  users[idx] = updated;
  writeUsers(users);
  return updated;
}

async function setOtp(email, otp, expiresAt) {
  const key = normalizeEmail(email);
  const existing = await findUserByEmail(key);
  if (!existing) return null;

  if (useFirebase()) {
    await userRef(key).update({ otp, otpExpiresAt: expiresAt });
    return { ...existing, otp, otpExpiresAt: expiresAt };
  }
  const users = readUsers();
  const idx = users.findIndex((u) => u.email === key);
  if (idx < 0) return null;
  users[idx] = { ...users[idx], otp, otpExpiresAt: expiresAt };
  writeUsers(users);
  return users[idx];
}

/* ---------- token (ไม่ต้องใช้ที่เก็บผู้ใช้ จึงยังเป็น sync) ---------- */
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