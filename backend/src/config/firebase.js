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
  const candidates = [
    process.env.FIREBASE_KEY_PATH,
    path.join(process.cwd(), 'serviceAccountKey.json'),
    path.join(__dirname, '../../../serviceAccountKey.json'),
  ].filter(Boolean);
  for (const localKeyPath of candidates) {
    if (fs.existsSync(localKeyPath)) {
      serviceAccount = require(localKeyPath);
      break;
    }
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
    try {
      initializeApp({
        credential: cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      console.log("✅ Firebase Admin initialized successfully!");
    } catch (err) {
      console.error("❌ Firebase Admin failed to initialize:", err.message);
    }
  } else {
    console.error("❌ Firebase Service Account is missing or invalid.");
  }
}

const isFirebaseReady = getApps().length > 0;
const db = isFirebaseReady ? getDatabase() : null;

module.exports = { admin, db, isFirebaseReady };