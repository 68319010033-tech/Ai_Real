const express = require('express');
const router = express.Router();
const axios = require('axios');
const { admin, db } = require('../config/firebase');

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://ai_worker:8000';

// Trigger การประมวลผลจัดตารางสอน
router.post('/generate', async (req, res) => {
  try {
    // 1. ดึงข้อมูล Master Data จาก Firebase Realtime Database
    const snapshot = await db.ref('/').once('value');
    const masterData = snapshot.val();

    if (!masterData) {
      return res.status(400).json({ error: 'No data found in Firebase' });
    }

    // แปลง Object เป็น Array เพื่อส่งให้ Solver
    const payload = {
      teachers: Object.values(masterData.teachers || {}),
      rooms: Object.values(masterData.rooms || {}),
      student_groups: Object.values(masterData.student_groups || {}),
      subjects: Object.values(masterData.subjects || {}),
      registers: Object.values(masterData.registers || {}),
      timeslots: Object.values(masterData.timeslots || {})
    };

    // 2. เรียกไปที่ AI Python Worker (CP-SAT)
    const response = await axios.post(`${AI_WORKER_URL}/solve`, payload);
    const result = response.data;

    // 3. บันทึกผลลัพธ์ลง Firebase RTDB ใน path /schedules/latest
    if (result.status === 'SUCCESS') {
      await db.ref('schedules/latest').set({
        updatedAt: new Date().toISOString(),
        data: result.schedule
      });
      return res.json({ message: 'Schedule generated successfully', count: result.schedule.length });
    } else {
      return res.status(422).json({ error: 'Unable to solve schedule with given constraints' });
    }

  } catch (error) {
    console.error('Error solving schedule:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to process schedule', details: error.response?.data || error.message });
  }
});

// ดึงผลลัพธ์ตารางสอนล่าสุด
router.get('/latest', async (req, res) => {
  try {
    const snapshot = await db.ref('schedules/latest').once('value');
    res.json(snapshot.val() || { message: 'No schedule generated yet' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;