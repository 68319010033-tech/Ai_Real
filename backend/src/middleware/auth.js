const { admin, isFirebaseReady } = require('../config/firebase');
const { verifyLocalToken } = require('../lib/localAuth');

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const local = verifyLocalToken(token);
    if (local) {
      req.user = local;
      return next();
    }

    if (isFirebaseReady) {
      try {
        req.user = await admin.auth().verifyIdToken(token);
        return next();
      } catch {
        // fall through
      }
    }

    return res.status(403).json({ error: 'Unauthorized: Invalid or expired token' });
  } catch (error) {
    console.error('Auth Middleware Error:', error.message);
    return res.status(403).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

module.exports = verifyToken;
