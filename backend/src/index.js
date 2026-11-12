const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const scheduleRoutes = require('./routes/schedule');
const errorHandler = require('./middleware/errorHandler');

const app = express();
// อยู่หลัง proxy ของ Render: ให้ Express อ่าน IP จริงของผู้ใช้จาก X-Forwarded-For
// (ไม่งั้น rate limit จะมองทุกคนเป็น IP เดียวกัน)
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Public auth routes first
app.use('/api/auth', authRoutes);

// Protected schedule routes next
app.use('/api', scheduleRoutes);
app.use('/api/schedule', scheduleRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'Backend API is running' });
});

// Register Global Error Handler (ไว้ล่างสุดเสมอ)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});