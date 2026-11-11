const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const scheduleRoutes = require('./routes/schedule');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
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