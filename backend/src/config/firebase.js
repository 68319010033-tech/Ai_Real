const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let serviceAccount;

// 1. ลองอ่านจาก Environment Variable (ใช้บน Render)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : process.env.FIREBASE_SERVICE_ACCOUNT;
  } catch (err) {
    console.error("❌ Error parsing FIREBASE_SERVICE_ACCOUNT JSON:", err.message);
  }
}

// 2. อ่านจากไฟล์ serviceAccountKey.json ในเครื่อง Local
if (!serviceAccount || !serviceAccount.private_key) {
  const localKeyPath = path.join(__dirname, '../../../serviceAccountKey.json'); // ชี้ไปที่ root Ai_Real/serviceAccountKey.json
  if (fs.existsSync(localKeyPath)) {
    serviceAccount = require(localKeyPath);
  }
}

if (serviceAccount && serviceAccount.private_key) {
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
}

// 3. Initialize Firebase
if (!getApps().length) {
  if (serviceAccount && serviceAccount.private_key) {
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log("✅ Firebase Admin initialized successfully!");
  } else {
    console.error("❌ Firebase Service Account is missing or invalid.");
  }
}

const db = getApps().length ? getDatabase() : null;

module.exports = { admin, db };