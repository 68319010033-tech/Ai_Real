const express = require('express');
const router = express.Router();
const { admin, db } = require('../config/firebase');
const { sendOTPEmail } = require('../config/brevo');
const { otpLimiter, registerLimiter } = require('../middleware/rateLimiter');

// 1. Register (ใส่ registerLimiter)
router.post('/register', registerLimiter, async (req, res, next) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || email.split('@')[0],
      emailVerified: false
    });

    await db.ref(`users/${userRecord.uid}`).set({
      email,
      displayName: userRecord.displayName,
      role: 'user',
      createdAt: new Date().toISOString()
    });

    res.status(201).json({ 
      message: 'User registered successfully', 
      uid: userRecord.uid, 
      email: userRecord.email 
    });
  } catch (error) {
    next(error);
  }
});

// 2. Request Password Reset OTP (ใส่ otpLimiter เพื่อป้องกันการยิง Brevo ถี่เกินไป)
router.post('/forgot-password', otpLimiter, async (req, res, next) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await admin.auth().getUserByEmail(email);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    await db.ref(`password_resets/${user.uid}`).set({
      otp: otpCode,
      expiresAt: expiresAt,
      verified: false
    });

    await sendOTPEmail(email, otpCode);

    res.json({ message: 'OTP sent to your email successfully' });
  } catch (error) {
    // ป้องกัน User Enumeration
    res.json({ message: 'If the email exists, an OTP has been sent.' });
  }
});

// 3. Verify OTP & Reset Password
router.post('/reset-password', async (req, res, next) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP, and newPassword are required' });
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    const snapshot = await db.ref(`password_resets/${user.uid}`).once('value');
    const resetData = snapshot.val();

    if (!resetData) {
      return res.status(400).json({ error: 'No OTP request found for this email' });
    }

    if (resetData.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    if (Date.now() > resetData.expiresAt) {
      return res.status(400).json({ error: 'OTP code has expired' });
    }

    await admin.auth().updateUser(user.uid, {
      password: newPassword
    });

    await db.ref(`password_resets/${user.uid}`).remove();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;