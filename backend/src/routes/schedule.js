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
const RTDB_MAX_BYTES = 5 * 1024 * 1024;
const SAFE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_PATH_KEYS = new Set(['.', '#', '$', '[', ']', '/', '\\', '%']);

const memory = {
  latestByUid: new Map(),
  jobs: new Map(),
  datasets: new Map(),
};

function isSafeKey(value, label) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return false;
  if (FORBIDDEN_PATH_KEYS.has(trimmed) || trimmed.includes('/')) return false;
  return SAFE_KEY_RE.test(trimmed);
}

function normalizeDatasetVersion(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error('datasetVersion must be a string');
  }
  const cleaned = value.trim();
  if (!SAFE_KEY_RE.test(cleaned)) {
    throw new Error('datasetVersion contains invalid characters. Use letters, numbers, -, _ only.');
  }
  return cleaned;
}

function normalizeScheduleId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('scheduleId must be a string');
  }
  const cleaned = value.trim();
  if (!SAFE_KEY_RE.test(cleaned)) {
    throw new Error('scheduleId contains invalid characters. Use letters, numbers, -, _ only.');
  }
  return cleaned;
}

function getUserUid(req) {
  return req?.user?.uid || null;
}

function datasetKey(uid, datasetVersion) {
  return `${uid}:${datasetVersion}`;
}

function datasetRef(uid, datasetVersion) {
  if (!db || !isSafeKey(uid, 'uid') || !isSafeKey(datasetVersion, 'datasetVersion')) {
    return null;
  }
  return `datasets/${uid}/${datasetVersion}`;
}

function scheduleRef(uid, scheduleId) {
  if (!db || !isSafeKey(uid, 'uid') || !isSafeKey(scheduleId, 'scheduleId')) {
    return null;
  }
  return `schedules/${uid}/${scheduleId}`;
}

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
    if (!SAFE_KEY_RE.test(name)) {
      throw new Error(`ตาราง ${name} มีชื่อไม่ปลอดภัยสำหรับ RTDB`);
    }
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

function shouldChunkDataset(tables = {}) {
  const payload = JSON.stringify({ tables, counts: countTables(tables) });
  return Buffer.byteLength(payload, 'utf8') > RTDB_MAX_BYTES;
}

async function saveDatasetToFirebase(uid, datasetVersion, tables, fileNames = []) {
  if (!db || !uid || !datasetVersion) {
    throw new Error('Dataset save failed: missing Firebase DB or uid/datasetVersion');
  }

  const ref = datasetRef(uid, datasetVersion);
  if (!ref) {
    throw new Error('Dataset save failed: invalid uid or datasetVersion');
  }

  const record = {
    uid,
    datasetVersion,
    counts: countTables(tables),
    fileNames,
    createdAt: new Date().toISOString(),
    tables: {},
    splitTables: false,
  };

  try {
    if (!shouldChunkDataset(tables)) {
      await db.ref(ref).set({ ...record, tables });
      return true;
    }

    await db.ref(ref).set({
      ...record,
      splitTables: true,
      tableNames: Object.keys(tables),
    });

    for (const [tableName, rows] of Object.entries(tables)) {
      if (!SAFE_KEY_RE.test(tableName)) {
        throw new Error(`Dataset save failed: forbidden table key "${tableName}"`);
      }
      await db.ref(`${ref}/tables/${tableName}`).set(rows);
    }
    return true;
  } catch (error) {
    console.error('Firebase dataset write failed:', error.message);
    throw new Error(`Dataset save failed: ${error.message}`);
  }
}

async function loadDatasetFromFirebase(uid, datasetVersion) {
  if (!db || !uid || !datasetVersion) return null;
  const ref = datasetRef(uid, datasetVersion);
  if (!ref) return null;

  try {
    const snapshot = await db.ref(ref).once('value');
    const value = snapshot.val();
    if (!value) return null;

    if (value.splitTables) {
      const tables = {};
      const tableNames = Array.isArray(value.tableNames) ? value.tableNames : Object.keys(value.tables || {});
      for (const tableName of tableNames) {
        const rowsSnapshot = await db.ref(`${ref}/tables/${tableName}`).once('value');
        const rows = rowsSnapshot.val() || [];
        tables[tableName] = rows;
      }
      return { ...value, tables, counts: countTables(tables) };
    }

    return { ...value, tables: value.tables || {} };
  } catch (error) {
    console.warn('Firebase dataset load skipped:', error.message);
    return null;
  }
}

async function saveScheduleToFirebase(uid, schedule) {
  if (!db || !uid || !schedule?.scheduleId) {
    throw new Error('Schedule save failed: missing Firebase DB, uid, or scheduleId');
  }

  const ref = scheduleRef(uid, schedule.scheduleId);
  if (!ref) {
    throw new Error('Schedule save failed: invalid uid or scheduleId');
  }

  try {
    await db.ref(ref).set(schedule);
    return true;
  } catch (error) {
    console.error('Firebase schedule write failed:', error.message);
    throw new Error(`Schedule save failed: ${error.message}`);
  }
}

async function loadScheduleFromFirebase(uid, scheduleId) {
  if (!db || !uid || !scheduleId) return null;
  const ref = scheduleRef(uid, scheduleId);
  if (!ref) return null;

  try {
    const snapshot = await db.ref(ref).once('value');
    return snapshot.val();
  } catch (error) {
    console.warn('Firebase schedule load skipped:', error.message);
    return null;
  }
}

function getLatestScheduleForUid(uid) {
  if (!uid) return null;
  return memory.latestByUid.get(uid) || null;
}

function setLatestScheduleForUid(uid, schedule) {
  if (!uid || !schedule) return;
  memory.latestByUid.set(uid, schedule);
}

async function resolveUserDataset(uid, datasetVersion, providedTables) {
  if (providedTables && typeof providedTables === 'object') {
    return { tables: providedTables };
  }
  if (!uid || !datasetVersion) return null;

  const inMemory = memory.datasets.get(datasetKey(uid, datasetVersion));
  if (inMemory) return inMemory;

  const fromFirebase = await loadDatasetFromFirebase(uid, datasetVersion);
  if (fromFirebase) {
    memory.datasets.set(datasetKey(uid, datasetVersion), fromFirebase);
    return fromFirebase;
  }

  return null;
}

async function resolveUserSchedule(uid, scheduleId) {
  if (!uid || !scheduleId) return null;

  const inMemory = [...memory.jobs.values()].find((job) => job.uid === uid && job.scheduleId === scheduleId);
  if (inMemory?.schedule) return inMemory.schedule;

  const latest = getLatestScheduleForUid(uid);
  if (latest && latest.scheduleId === scheduleId) return latest;

  const fromFirebase = await loadScheduleFromFirebase(uid, scheduleId);
  if (fromFirebase) return fromFirebase;

  return null;
}

async function runAiSolve(payload, timeoutMs) {
  const response = await axios.post(`${AI_WORKER_URL}/solve`, payload, {
    timeout: timeoutMs,
  });
  return response.data;
}

function getStoredSchedule(uid, scheduleId) {
  if (!uid) return null;
  if (!scheduleId || scheduleId === 'latest') return getLatestScheduleForUid(uid);

  const latest = getLatestScheduleForUid(uid);
  if (latest?.scheduleId === scheduleId) return latest;

  for (const job of memory.jobs.values()) {
    if (job.uid === uid && job.schedule && job.schedule.scheduleId === scheduleId) return job.schedule;
  }
  return null;
}

router.post('/datasets/import', verifyToken, upload.array('files', 20), async (req, res) => {
  const uid = getUserUid(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized: missing user context' });
  }

  let tables = {};
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    tables = tablesFromFiles(files);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Invalid uploaded dataset' });
  }

  const errors = datasetErrors(tables);
  let datasetVersion;
  try {
    datasetVersion = normalizeDatasetVersion(req.body?.datasetVersion || `ds-${Date.now()}`);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (!req.files || req.files.length === 0) {
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

  if (errors.some((err) => err.code === 'SCHEMA_INVALID')) {
    return res.status(400).json({ datasetVersion, counts: countTables(tables), errors });
  }

  const datasetRecord = {
    uid,
    datasetVersion,
    tables,
    counts: countTables(tables),
    createdAt: new Date().toISOString(),
    fileNames: (req.files || []).map((file) => file.originalname || file.name),
  };

  memory.datasets.set(datasetKey(uid, datasetVersion), datasetRecord);

  try {
    await saveDatasetToFirebase(uid, datasetVersion, tables, datasetRecord.fileNames);
    return res.json({ datasetVersion, counts: datasetRecord.counts, errors });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Dataset write failed',
      datasetVersion,
      counts: datasetRecord.counts,
      errors,
    });
  }
});

router.post('/solve-jobs', verifyToken, async (req, res) => {
  const uid = getUserUid(req);
  const body = req.body || {};
  const jobId = makeJobId();

  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized: missing user context' });
  }

  let datasetVersion;
  try {
    const rawDatasetVersion = body.datasetVersion ?? 'local';
    datasetVersion = normalizeDatasetVersion(rawDatasetVersion);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const providedTables = body.tables && typeof body.tables === 'object' ? body.tables : null;
  const resolvedDataset = await resolveUserDataset(uid, datasetVersion, providedTables);
  const tables = resolvedDataset?.tables || providedTables;

  if (!tables) {
    return res.status(400).json({ error: 'ไม่พบชุดข้อมูล กรุณาอัปโหลดและตรวจไฟล์ก่อนจัดตาราง' });
  }

  const job = {
    jobId,
    uid,
    status: 'queued',
    solverStatus: 'QUEUED',
    datasetVersion,
    timeLimitSeconds: Number(body.timeLimitSeconds || 30),
    seed: Number(body.seed || 1),
    specialRules: Array.isArray(body.specialRules) ? body.specialRules : [],
    constraints: body.constraints || {
      blockedSlots: [],
      reservedSlots: [],
      roomLocks: [],
      maxPeriodsPerDay: 10,
      roomTypeMatch: false,
    },
    tables,
    createdAt: new Date().toISOString(),
  };

  memory.jobs.set(jobId, job);
  res.json({
    jobId,
    status: 'queued',
    solverStatus: 'QUEUED',
    logs: [],
    stats: { variables: 0, constraints: 0, conflicts: 0, branches: 0, wallTimeSec: 0, objective: null },
  });

  setImmediate(async () => {
    const current = memory.jobs.get(jobId);
    if (!current || current.status === 'cancelled') return;

    current.status = 'running';
    current.solverStatus = 'RUNNING';
    memory.jobs.set(jobId, current);

    try {
      const payload = buildSolverPayload(current.tables, current.specialRules, current.timeLimitSeconds, current.constraints || {});
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
          current.logs = detail?.logs || [];
          current.stats = detail?.stats || { variables: 0, constraints: 0, conflicts: 0, branches: 0, wallTimeSec: 0, objective: null };
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
        schedule.uid = uid;
        schedule.scheduleId = scheduleId;
        schedule.datasetVersion = current.datasetVersion;
        schedule.specialRules = current.specialRules;
        schedule.constraints = payload.constraints;

        current.status = 'completed';
        current.solverStatus = schedule.solverStatus;
        current.scheduleId = scheduleId;
        current.schedule = schedule;
        current.logs = Array.isArray(result.logs) ? result.logs : [];
        current.stats = result.stats || { variables: 0, constraints: 0, conflicts: 0, branches: 0, wallTimeSec: 0, objective: null };
        current.completedAt = new Date().toISOString();
        setLatestScheduleForUid(uid, schedule);
        memory.jobs.set(jobId, current);

        try {
          await saveScheduleToFirebase(uid, schedule);
        } catch (error) {
          current.error = error.message;
          current.status = 'failed';
          current.solverStatus = 'FAILED';
          memory.jobs.set(jobId, current);
        }
        return;
      }

      current.status = 'completed';
      current.solverStatus = result.solver_status || result.status || 'INFEASIBLE';
      current.error = result.reason || result.detail || 'ไม่พบตารางที่ตรงเงื่อนไขทั้งหมด';
      current.logs = Array.isArray(result.logs) ? result.logs : [];
      current.stats = result.stats || { variables: 0, constraints: 0, conflicts: 0, branches: 0, wallTimeSec: 0, objective: null };
      current.completedAt = new Date().toISOString();
      memory.jobs.set(jobId, current);
    } catch (error) {
      if (current.status === 'cancelled') return;
      current.status = 'failed';
      current.solverStatus = 'FAILED';
      current.error = error?.response?.data?.detail || error?.message || 'AI worker unavailable';
      current.completedAt = new Date().toISOString();
      current.logs = [];
      current.stats = { variables: 0, constraints: 0, conflicts: 0, branches: 0, wallTimeSec: 0, objective: null };
      memory.jobs.set(jobId, current);
    }
  });
});

router.get('/solve-jobs/:jobId', verifyToken, async (req, res) => {
  const uid = getUserUid(req);
  const job = [...memory.jobs.values()].find((candidate) => candidate.jobId === req.params.jobId && candidate.uid === uid);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  return res.json({
    jobId: job.jobId,
    status: job.status,
    solverStatus: job.solverStatus,
    scheduleId: job.scheduleId || null,
    logs: Array.isArray(job.logs) ? job.logs : [],
    stats: job.stats || { variables: 0, constraints: 0, conflicts: 0, branches: 0, wallTimeSec: 0, objective: null },
    infeasibleRules: job.infeasibleRules || [],
    error: job.error || null,
    datasetVersion: job.datasetVersion,
  });
});

router.post('/solve-jobs/:jobId/cancel', verifyToken, async (req, res) => {
  const uid = getUserUid(req);
  const job = [...memory.jobs.values()].find((candidate) => candidate.jobId === req.params.jobId && candidate.uid === uid);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.status = 'cancelled';
  job.solverStatus = 'CANCELLED';
  memory.jobs.set(job.jobId, job);
  return res.json({ jobId: job.jobId, status: 'cancelled' });
});

router.get('/schedules/:id', verifyToken, async (req, res) => {
  const uid = getUserUid(req);
  const schedule = await resolveUserSchedule(uid, req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ยังไม่มีตาราง หรือรหัสตารางไม่ถูกต้อง' });
  return res.json(schedule);
});

router.get('/schedules/:id/export', verifyToken, async (req, res) => {
  const uid = getUserUid(req);
  const { id } = req.params;
  const format = (req.query.format || 'csv').toLowerCase();
  const schedule = await resolveUserSchedule(uid, id);
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
  const uid = getUserUid(req);
  const schedule = await resolveUserSchedule(uid, req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

  const datasetRecord = await resolveUserDataset(uid, schedule.datasetVersion, null);
  const tables = datasetRecord?.tables || null;
  if (!tables) return res.status(400).json({ error: 'ไม่พบชุดข้อมูลที่ใช้สร้างตารางนี้' });

  return res.json(validateSchedule(schedule, tables, schedule.specialRules || []));
});

router.post('/generate', verifyToken, async (req, res) => {
  const uid = getUserUid(req);
  const body = req.body || {};
  let datasetVersion;
  try {
    datasetVersion = normalizeDatasetVersion(body.datasetVersion || 'local');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const resolved = await resolveUserDataset(uid, datasetVersion, body.tables || null);
  const tables = resolved?.tables || body.tables || null;

  if (!tables) return res.status(400).json({ error: 'ไม่พบชุดข้อมูล' });

  try {
    const payload = buildSolverPayload(tables, body.specialRules || [], body.timeLimitSeconds || 60);
    const result = await runAiSolve(payload, 80000);
    if (result.status !== 'SUCCESS') {
      return res.status(422).json({ error: 'Unable to solve schedule with given constraints' });
    }
    const scheduleId = makeScheduleId();
    const schedule = buildScheduleView(scheduleId, 'FEASIBLE', datasetVersion, result.schedule || [], tables);
    schedule.constraints = payload.constraints;
    schedule.uid = uid;
    schedule.scheduleId = scheduleId;
    schedule.datasetVersion = datasetVersion;
    setLatestScheduleForUid(uid, schedule);
    try {
      await saveScheduleToFirebase(uid, schedule);
      return res.json({ message: 'Schedule generated successfully', count: (result.schedule || []).length, scheduleId });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Schedule save failed' });
    }
  } catch (error) {
    console.error('Error solving schedule:', error?.response?.data || error?.message);
    return res.status(500).json({ error: 'Failed to process schedule', details: error?.response?.data || error?.message });
  }
});

router.get('/latest', verifyToken, async (req, res) => {
  const uid = getUserUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const latestJob = [...memory.jobs.values()].filter((job) => job.uid === uid).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latestJob?.schedule) return res.json(latestJob.schedule);
  const latest = getLatestScheduleForUid(uid);
  if (latest) return res.json(latest);
  return res.status(404).json({ error: 'No schedule generated yet' });
});

module.exports = router;
