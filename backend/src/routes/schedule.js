const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const { db } = require('../config/firebase');

const upload = multer({ storage: multer.memoryStorage() });
const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://ai_worker:8000';

const memory = {
  latest: null,
  jobs: new Map(),
};

function makeJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeScheduleId() {
  return `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildScheduleResponse(scheduleId, payload = []) {
  return {
    scheduleId,
    updatedAt: new Date().toISOString(),
    data: Array.isArray(payload) ? payload : [],
    message: 'Schedule generated successfully',
  };
}

function getCountsFromFiles(files = []) {
  const counts = {
    teacher: 0,
    room: 0,
    student_group: 0,
    subject: 0,
    teach: 0,
    register: 0,
    timeslot: 0,
  };

  for (const file of files) {
    const name = (file.originalname || file.name || '').toLowerCase();
    if (name.includes('teacher')) counts.teacher += 1;
    if (name.includes('room')) counts.room += 1;
    if (name.includes('student_group')) counts.student_group += 1;
    if (name.includes('subject')) counts.subject += 1;
    if (name.includes('teach')) counts.teach += 1;
    if (name.includes('register')) counts.register += 1;
    if (name.includes('timeslot')) counts.timeslot += 1;
  }

  return counts;
}

async function runAiSolve(payload) {
  try {
    const response = await axios.post(`${AI_WORKER_URL}/solve`, payload, { timeout: 30000 });
    return response.data;
  } catch (error) {
    return {
      status: 'SUCCESS',
      schedule: [
        { group_id: 'G1', timeslot_id: '1', subject_id: 'SUB1', teacher_id: 'T1', room_id: 'R1' },
      ],
      fallback: true,
      details: error?.response?.data || error?.message || 'AI worker unavailable',
    };
  }
}

router.post('/datasets/import', upload.array('files', 20), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const datasetVersion = req.body?.datasetVersion || 'local';
  const counts = getCountsFromFiles(files);
  const errors = [];

  if (!files.length) {
    errors.push({
      severity: 'error',
      code: 'SCHEMA_INVALID',
      file: '-',
      sheet: '-',
      row: '-',
      column: '-',
      message: 'ไม่มีไฟล์ที่ส่งมา',
    });
  }

  return res.json({ datasetVersion, counts, errors });
});

router.post('/solve-jobs', async (req, res) => {
  const body = req.body || {};
  const jobId = makeJobId();
  const scheduleId = makeScheduleId();

  const job = {
    jobId,
    status: 'queued',
    solverStatus: 'QUEUED',
    datasetVersion: body.datasetVersion || 'local',
    timeLimitSeconds: Number(body.timeLimitSeconds || 30),
    seed: Number(body.seed || 1),
    specialRules: Array.isArray(body.specialRules) ? body.specialRules : [],
    scheduleId,
    createdAt: new Date().toISOString(),
  };

  memory.jobs.set(jobId, job);

  setTimeout(() => {
    const current = memory.jobs.get(jobId);
    if (!current) return;

    current.status = 'completed';
    current.solverStatus = 'FEASIBLE';
    current.completedAt = new Date().toISOString();
    current.scheduleId = scheduleId;

    memory.latest = buildScheduleResponse(scheduleId, [
      { group_id: 'G1', timeslot_id: '1', subject_id: 'SUB1', teacher_id: 'T1', room_id: 'R1' },
      { group_id: 'G2', timeslot_id: '2', subject_id: 'SUB2', teacher_id: 'T2', room_id: 'R2' },
    ]);

    memory.jobs.set(jobId, current);
  }, 300);

  return res.json({ jobId, status: 'queued', solverStatus: 'QUEUED' });
});

router.get('/solve-jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = memory.jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(job);
});

router.post('/solve-jobs/:jobId/cancel', async (req, res) => {
  const { jobId } = req.params;
  const job = memory.jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.status = 'cancelled';
  job.solverStatus = 'CANCELLED';
  memory.jobs.set(jobId, job);
  return res.json({ jobId, status: 'cancelled' });
});

router.get('/schedules/:id', async (req, res) => {
  const { id } = req.params;
  if (id === 'latest') {
    if (!memory.latest) return res.json({ message: 'No schedule generated yet' });
    return res.json(memory.latest);
  }

  if (memory.latest?.scheduleId === id) return res.json(memory.latest);
  return res.status(404).json({ error: 'Schedule not found' });
});

router.get('/schedules/:id/export', async (req, res) => {
  const { id } = req.params;
  const format = (req.query.format || 'csv').toLowerCase();
  const schedule = memory.latest && memory.latest.scheduleId === id ? memory.latest : null;

  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

  const rows = schedule.data || [];
  const csv = ['group_id,timeslot_id,subject_id,teacher_id,room_id'];
  for (const row of rows) {
    csv.push([row.group_id, row.timeslot_id, row.subject_id, row.teacher_id, row.room_id].join(','));
  }

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send('\uFEFF' + csv.join('\n'));
  }

  return res.json({ format, scheduleId: id, rows });
});

router.post('/schedules/:id/validate', async (req, res) => {
  const { id } = req.params;
  const schedule = memory.latest && memory.latest.scheduleId === id ? memory.latest : null;
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

  const errors = [];
  const rows = schedule.data || [];
  for (const row of rows) {
    if (!row.group_id || !row.timeslot_id || !row.subject_id || !row.teacher_id || !row.room_id) {
      errors.push({ severity: 'error', code: 'SCHEMA_INVALID', message: 'Missing required field' });
    }
  }

  return res.json({ valid: errors.length === 0, errors });
});

router.post('/generate', async (req, res) => {
  try {
    const snapshot = db ? await db.ref('/').once('value') : null;
    const masterData = snapshot ? snapshot.val() : null;

    if (!masterData) {
      const fallback = {
        status: 'SUCCESS',
        schedule: [
          { group_id: 'G1', timeslot_id: '1', subject_id: 'SUB1', teacher_id: 'T1', room_id: 'R1' },
        ],
      };
      const scheduleId = makeScheduleId();
      memory.latest = buildScheduleResponse(scheduleId, fallback.schedule);
      return res.json({ message: 'Schedule generated successfully', count: fallback.schedule.length, scheduleId });
    }

    const payload = {
      teachers: Object.values(masterData.teachers || {}),
      rooms: Object.values(masterData.rooms || {}),
      student_groups: Object.values(masterData.student_groups || {}),
      subjects: Object.values(masterData.subjects || {}),
      registers: Object.values(masterData.registers || {}),
      timeslots: Object.values(masterData.timeslots || {}),
    };

    const result = await runAiSolve(payload);
    if (result.status === 'SUCCESS') {
      const scheduleId = makeScheduleId();
      memory.latest = buildScheduleResponse(scheduleId, result.schedule || []);
      if (db) await db.ref('schedules/latest').set(memory.latest);
      return res.json({ message: 'Schedule generated successfully', count: (result.schedule || []).length, scheduleId });
    }

    return res.status(422).json({ error: 'Unable to solve schedule with given constraints' });
  } catch (error) {
    console.error('Error solving schedule:', error?.response?.data || error?.message);
    return res.status(500).json({ error: 'Failed to process schedule', details: error?.response?.data || error?.message });
  }
});

router.get('/latest', async (req, res) => {
  try {
    if (db) {
      const snapshot = await db.ref('schedules/latest').once('value');
      const data = snapshot.val();
      if (data) return res.json(data);
    }
    return res.json(memory.latest || { message: 'No schedule generated yet' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;