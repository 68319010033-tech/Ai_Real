const express = require('express');
const router = express.Router();
const { admin, db, isFirebaseReady } = require('../config/firebase');
const { sendOTPEmail } = require('../config/brevo');
const { otpLimiter, registerLimiter } = require('../middleware/rateLimiter');
const {
  findUserByEmail,
  createLocalUser,
  updateLocalPassword,
  setOtp,
  verifyPassword,
  signToken,
  publicUser,
} = require('../lib/localAuth');

function canUseFirebase() {
  return !!(isFirebaseReady && admin && db);
}

router.post('/register', registerLimiter, async (req, res, next) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'กรอกอีเมลและรหัสผ่าน' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
  }

  try {
    const user = createLocalUser({ email, password, displayName });

    if (canUseFirebase()) {
      try {
        const userRecord = await admin.auth().createUser({
          email: user.email,
          password,
          displayName: user.displayName,
          emailVerified: false,
        });
        await db.ref(`users/${userRecord.uid}`).set({
          email: user.email,
          displayName: user.displayName,
          role: 'user',
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn('Firebase register skipped:', error.message);
      }
    }

    return res.status(201).json({
      message: 'User registered successfully',
      ...publicUser(user),
      token: signToken(user),
    });
  } catch (error) {
    if (error.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });
    }
    return next(error);
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'กรอกอีเมลและรหัสผ่าน' });
  }

  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }

  return res.json({
    message: 'Login successful',
    ...publicUser(user),
    token: signToken(user),
  });
});

router.post('/forgot-password', otpLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'กรอกอีเมล' });

  const user = findUserByEmail(email);
  if (user) {
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    setOtp(email, otpCode, expiresAt);
    try {
      await sendOTPEmail(user.email, otpCode);
    } catch (error) {
      console.warn('OTP email skipped:', error.message);
      return res.status(502).json({
        error: 'ส่ง OTP ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือตรวจ Brevo configuration',
        detail: error.message,
      });
    }
  }

  return res.json({ message: 'ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่ง OTP ไปแล้ว' });
});

router.post('/reset-password', async (req, res, next) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'กรอกอีเมล OTP และรหัสผ่านใหม่' });
  }

  try {
    const user = findUserByEmail(email);
    if (!user || !user.otp) {
      return res.status(400).json({ error: 'ไม่พบคำขอ OTP ของอีเมลนี้' });
    }
    if (String(user.otp) !== String(otp)) {
      return res.status(400).json({ error: 'รหัส OTP ไม่ถูกต้อง' });
    }
    if (Date.now() > user.otpExpiresAt) {
      return res.status(400).json({ error: 'รหัส OTP หมดอายุแล้ว' });
    }

    const updated = updateLocalPassword(email, newPassword);
    if (canUseFirebase()) {
      try {
        const firebaseUser = await admin.auth().getUserByEmail(user.email);
        await admin.auth().updateUser(firebaseUser.uid, { password: newPassword });
      } catch (error) {
        console.warn('Firebase password update skipped:', error.message);
      }
    }

    return res.json({
      message: 'รีเซ็ตรหัสผ่านสำเร็จ',
      email: updated.email,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
