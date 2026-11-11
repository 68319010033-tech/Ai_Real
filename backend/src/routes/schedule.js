const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const { db } = require('../config/firebase');
const { parseCsv, tableNameFromFile } = require('../lib/csv');
const { buildSolverPayload, buildScheduleView } = require('../lib/dataset');
const { validateSchedule } = require('../lib/validateSchedule');
const verifyToken = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });
const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://ai_worker:8000';

const memory = {
  latest: null,
  jobs: new Map(),
  datasets: new Map(),
};

function makeJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeScheduleId() {
  return `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function countTables(tables = {}) {
  return {
    teacher: tables.teacher?.length || 0,
    room: tables.room?.length || 0,
    student_group: tables.student_group?.length || 0,
    subject: tables.subject?.length || 0,
    teach: tables.teach?.length || 0,
    register: tables.register?.length || 0,
    timeslot: tables.timeslot?.length || 0,
  };
}

function tablesFromFiles(files = []) {
  const tables = {};
  for (const file of files) {
    const name = tableNameFromFile(file.originalname || file.name);
    if (!name) continue;
    const text = Buffer.from(file.buffer || []).toString('utf8');
    tables[name] = parseCsv(text);
  }
  return tables;
}

function datasetErrors(tables) {
  const errors = [];
  const required = ['teacher', 'room', 'student_group', 'subject', 'teach', 'register', 'timeslot'];
  for (const name of required) {
    if (!tables[name]?.length) {
      errors.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        file: `${name}.csv`,
        sheet: '-',
        row: '-',
        column: '-',
        message: `ไม่พบข้อมูลตาราง ${name}`,
      });
    }
  }
  return errors;
}

async function runAiSolve(payload, timeoutMs) {
  const response = await axios.post(`${AI_WORKER_URL}/solve`, payload, {
    timeout: timeoutMs,
  });
  return response.data;
}

function getStoredSchedule(id) {
  if (!id || id === 'latest') return memory.latest;
  if (memory.latest?.scheduleId === id) return memory.latest;
  for (const job of memory.jobs.values()) {
    if (job.schedule && job.schedule.scheduleId === id) return job.schedule;
  }
  return null;
}

router.post('/datasets/import', verifyToken, upload.array('files', 20), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const tables = tablesFromFiles(files);
  const errors = datasetErrors(tables);
  const datasetVersion = req.body?.datasetVersion || `ds-${Date.now()}`;
  memory.datasets.set(datasetVersion, { tables, createdAt: new Date().toISOString() });

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

  return res.json({ datasetVersion, counts: countTables(tables), errors });
});

router.post('/solve-jobs', verifyToken, async (req, res) => {
  const body = req.body || {};
  const jobId = makeJobId();
  const tables = body.tables && typeof body.tables === 'object'
    ? body.tables
    : memory.datasets.get(body.datasetVersion)?.tables;

  if (!tables) {
    return res.status(400).json({ error: 'ไม่พบชุดข้อมูล กรุณาอัปโหลดและตรวจไฟล์ก่อนจัดตาราง' });
  }

  const job = {
    jobId,
    status: 'queued',
    solverStatus: 'QUEUED',
    datasetVersion: body.datasetVersion || 'local',
    timeLimitSeconds: Number(body.timeLimitSeconds || 30),
    seed: Number(body.seed || 1),
    specialRules: Array.isArray(body.specialRules) ? body.specialRules : [],
    tables,
    createdAt: new Date().toISOString(),
  };

  memory.jobs.set(jobId, job);
  res.json({ jobId, status: 'queued', solverStatus: 'QUEUED' });

  setImmediate(async () => {
    const current = memory.jobs.get(jobId);
    if (!current || current.status === 'cancelled') return;
    current.status = 'running';
    current.solverStatus = 'RUNNING';
    memory.jobs.set(jobId, current);

    try {
      const payload = buildSolverPayload(current.tables, current.specialRules, current.timeLimitSeconds);
      const timeoutMs = Math.max(45000, (current.timeLimitSeconds + 20) * 1000);
      let result;
      try {
        result = await runAiSolve(payload, timeoutMs);
      } catch (error) {
        const detail = error?.response?.data;
        if (error?.response?.status === 400 || detail?.status === 'INFEASIBLE') {
          current.status = 'completed';
          current.solverStatus = 'INFEASIBLE';
          current.error = detail?.detail || 'ไม่พบตารางที่ตรงเงื่อนไขทั้งหมด';
          current.completedAt = new Date().toISOString();
          memory.jobs.set(jobId, current);
          return;
        }
        throw error;
      }

      if (current.status === 'cancelled') return;

      if (result.status === 'SUCCESS') {
        const scheduleId = makeScheduleId();
        const schedule = buildScheduleView(
          scheduleId,
          result.solver_status || 'FEASIBLE',
          current.datasetVersion,
          result.schedule || [],
          current.tables,
        );
        schedule.specialRules = current.specialRules;
        current.status = 'completed';
        current.solverStatus = schedule.solverStatus;
        current.scheduleId = scheduleId;
        current.schedule = schedule;
        current.completedAt = new Date().toISOString();
        memory.latest = schedule;
        memory.jobs.set(jobId, current);
        if (db) {
          try {
            await db.ref('schedules/latest').set(schedule);
          } catch (error) {
            console.warn('Firebase schedule save skipped:', error.message);
          }
        }
        return;
      }

      current.status = 'completed';
      current.solverStatus = result.status || 'INFEASIBLE';
      current.error = result.detail || 'ไม่พบตารางที่ตรงเงื่อนไขทั้งหมด';
      current.completedAt = new Date().toISOString();
      memory.jobs.set(jobId, current);
    } catch (error) {
      if (current.status === 'cancelled') return;
      current.status = 'failed';
      current.solverStatus = 'FAILED';
      current.error = error?.response?.data?.detail || error?.message || 'AI worker unavailable';
      current.completedAt = new Date().toISOString();
      memory.jobs.set(jobId, current);
    }
  });
});

router.get('/solve-jobs/:jobId', verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const job = memory.jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json({
    jobId: job.jobId,
    status: job.status,
    solverStatus: job.solverStatus,
    scheduleId: job.scheduleId || null,
    error: job.error || null,
    datasetVersion: job.datasetVersion,
  });
});

router.post('/solve-jobs/:jobId/cancel', verifyToken, async (req, res) => {
  const { jobId } = req.params;
  const job = memory.jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.status = 'cancelled';
  job.solverStatus = 'CANCELLED';
  memory.jobs.set(jobId, job);
  return res.json({ jobId, status: 'cancelled' });
});

router.get('/schedules/:id', verifyToken, async (req, res) => {
  const schedule = getStoredSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ยังไม่มีตาราง หรือรหัสตารางไม่ถูกต้อง' });
  return res.json(schedule);
});

router.get('/schedules/:id/export', verifyToken, async (req, res) => {
  const { id } = req.params;
  const format = (req.query.format || 'csv').toLowerCase();
  const schedule = getStoredSchedule(id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

  const rows = schedule.data || [];
  const csv = ['group_id,timeslot_id,subject_id,teacher_id,room_id'];
  for (const row of rows) {
    csv.push([row.group_id, row.timeslot_id, row.subject_id, row.teacher_id, row.room_id].join(','));
  }

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="output.csv"`);
    return res.send('\uFEFF' + csv.join('\n'));
  }

  return res.status(501).json({ error: `ยังไม่รองรับไฟล์ ${format.toUpperCase()} ใช้ CSV ก่อน` });
});

router.post('/schedules/:id/validate', verifyToken, async (req, res) => {
  const schedule = getStoredSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  const dataset = memory.datasets.get(schedule.datasetVersion);
  const tables = dataset?.tables || [...memory.jobs.values()].find((j) => j.scheduleId === schedule.scheduleId)?.tables;
  if (!tables) return res.status(400).json({ error: 'ไม่พบชุดข้อมูลที่ใช้สร้างตารางนี้' });
  return res.json(validateSchedule(schedule, tables, schedule.specialRules || []));
});

router.post('/generate', verifyToken, async (req, res) => {
  const body = req.body || {};
  const tables = body.tables || memory.datasets.get(body.datasetVersion)?.tables;
  if (!tables) return res.status(400).json({ error: 'ไม่พบชุดข้อมูล' });

  try {
    const payload = buildSolverPayload(tables, body.specialRules || [], body.timeLimitSeconds || 60);
    const result = await runAiSolve(payload, 80000);
    if (result.status !== 'SUCCESS') {
      return res.status(422).json({ error: 'Unable to solve schedule with given constraints' });
    }
    const scheduleId = makeScheduleId();
    const schedule = buildScheduleView(scheduleId, 'FEASIBLE', body.datasetVersion || 'local', result.schedule || [], tables);
    memory.latest = schedule;
    return res.json({ message: 'Schedule generated successfully', count: (result.schedule || []).length, scheduleId });
  } catch (error) {
    console.error('Error solving schedule:', error?.response?.data || error?.message);
    return res.status(500).json({ error: 'Failed to process schedule', details: error?.response?.data || error?.message });
  }
});

router.get('/latest', verifyToken, async (req, res) => {
  if (memory.latest) return res.json(memory.latest);
  return res.status(404).json({ error: 'No schedule generated yet' });
});

module.exports = router;
