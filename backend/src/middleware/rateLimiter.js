const rateLimit = require('express-rate-limit');

// จำกัดการส่งขอ OTP: ส่งได้ไม่เกิน 3 ครั้ง ต่อ 15 นาที ต่อ 1 IP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 นาที
  max: 3,
  message: {
    error: 'Too many OTP requests from this IP, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// จำกัดการยิง API สมัครสมาชิก: สมัครได้ไม่เกิน 5 บัญชี ต่อ 1 ชั่วโมง ต่อ 1 IP
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 ชั่วโมง
  max: 5,
  message: {
    error: 'Too many accounts created from this IP, please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { otpLimiter, registerLimiter };