const { jointPolicy } = require('./jointClasses');

const DAY_NUM = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5,
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
  จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, ศุกร์: 5,
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rows(tables, name) {
  const list = tables?.[name];
  return Array.isArray(list) ? list : [];
}

function dayNumber(value) {
  const key = String(value ?? '').trim();
  return DAY_NUM[key] || Number(key) || 0;
}

function isLeader(role) {
  return /leader/i.test(String(role || ''));
}

function isEnglishSubject(subject = {}) {
  const subjectId = String(subject.subject_id || '').trim();
  const subjectName = String(subject.subject_name || '').trim();
  return subjectId === '30000-1202' || /english|อังกฤษ/i.test(`${subjectId} ${subjectName}`);
}

function buildRoomLocks(tables, specialRules = []) {
  const subjects = rows(tables, 'subject');
  const selected = new Set(specialRules);
  const locks = [];
  const add = (ruleId, roomId, match) => {
    if (!selected.has(ruleId)) return;
    subjects.filter(match).forEach((s) => {
      locks.push({ ruleId, subject_id: String(s.subject_id), room_id: roomId });
    });
  };

  add('C14', 'R6201', (s) => /iot|ไอโอที/i.test(`${s.subject_id} ${s.subject_name}`));
  add('C15', 'R6203', (s) => ['31901-2002', '31900-0004'].includes(String(s.subject_id)));
  add('C16', 'R6405', (s) => ['31901-2006', '31901-2009'].includes(String(s.subject_id)));
  add('C17', 'R6205', (s) => String(s.subject_id) === '21901-2010');
  add('C18', 'R5204', isEnglishSubject);
  return locks;
}

// Explicit synthetic homeroom augmentation; source tables are never mutated.
function withHomeroom(tables) {
  const copy = Object.fromEntries(Object.entries(tables).map(([k,v]) => [k,Array.isArray(v) ? v.map(r=>({...r})) : v]));
  copy.subject ||= []; copy.register ||= []; copy.teach ||= [];
  const existing = copy.subject.find(s => /homeroom|โฮมรูม|home\s*room/i.test(`${s.subject_id} ${s.subject_name}`));
  const sid = existing ? String(existing.subject_id) : 'HOMEROOM';
  if (!existing) copy.subject.push({subject_id:sid,subject_name:'Homeroom',theory:1,practice:0});
  for (const group of rows(copy,'student_group')) {
    const has = copy.register.some(r=>String(r.group_id)===String(group.group_id) && String(r.subject_id)===sid);
    if (!has) copy.register.push({group_id:String(group.group_id),subject_id:sid});
  }
  if (!existing) for (const teacher of rows(copy,'teacher')) copy.teach.push({teacher_id:String(teacher.teacher_id),subject_id:sid});
  return copy;
}

function buildSolverPayload(tables, specialRules = [], timeLimitSeconds = 60, constraints = {}) {
  if (specialRules.some(rule=>!['C14','C15','C16','C17','C18','C19'].includes(rule))) {
    throw Object.assign(new Error('Unsupported special rule. C20, C22 and C23 are not implemented.'),{code:'INVALID_INPUT'});
  }
  const teachers = rows(tables, 'teacher').map((t) => ({
    teacher_id: String(t.teacher_id),
    teacher_name: t.teacher_name,
    role: t.role,
    is_leader: isLeader(t.role),
  }));

  const rooms = rows(tables, 'room').map((r) => ({
    room_id: String(r.room_id),
    room_name: r.room_name,
    room_type: r.room_type,
  }));

  const student_groups = rows(tables, 'student_group').map((g) => ({
    group_id: String(g.group_id),
    group_name: g.group_name,
    student_count: num(g.student_count),
    advisor: g.advisor,
    advisor_id: g.advisor_id ? String(g.advisor_id) : undefined,
  }));

  const subjects = rows(tables, 'subject').map((s) => ({
    subject_id: String(s.subject_id),
    subject_name: s.subject_name,
    theory: num(s.theory),
    practice: num(s.practice),
    theory_hours: num(s.theory),
    practice_hours: num(s.practice),
    credit: num(s.credit),
    room_type: s.room_type,
  }));

  const teaches = rows(tables, 'teach').map((t) => ({
    teacher_id: String(t.teacher_id),
    subject_id: String(t.subject_id),
  }));

  const registers = rows(tables, 'register').map((r) => ({
    group_id: String(r.group_id),
    subject_id: String(r.subject_id),
    teacher_id: r.teacher_id ? String(r.teacher_id) : undefined,
  }));

  const timeslots = rows(tables, 'timeslot').map((t) => ({
    timeslot_id: String(t.timeslot_id),
    day: dayNumber(t.day),
    period: num(t.period),
    start: t.start,
    end: t.end,
  }));

  return {
    teachers,
    rooms,
    student_groups,
    subjects,
    teaches,
    registers,
    timeslots,
    special_rules: specialRules,
    constraints: {
      ...jointPolicy(tables),
      blockedSlots: Array.isArray(constraints.blockedSlots) ? constraints.blockedSlots : [],
      reservedSlots: Array.isArray(constraints.reservedSlots) ? constraints.reservedSlots : [],
      roomLocks: Array.isArray(constraints.roomLocks) ? constraints.roomLocks : [],
      maxPeriodsPerDay: Number(constraints.maxPeriodsPerDay) || 10,
      roomTypeMatch: true,
    },
    room_locks: buildRoomLocks(tables, specialRules),
    time_limit_seconds: Number(timeLimitSeconds) || 60,
  };
}

function buildScheduleView(scheduleId, solverStatus, datasetVersion, scheduleRows, tables) {
  const subjectById = Object.fromEntries(
    rows(tables, 'subject').map((s) => [String(s.subject_id), s]),
  );
  const teacherById = Object.fromEntries(rows(tables, 'teacher').map((t) => [String(t.teacher_id), t]));
  const roomById = Object.fromEntries(rows(tables, 'room').map((r) => [String(r.room_id), r]));
  const grouped = new Map();

  for (const row of scheduleRows || []) {
    const subjectId = String(row.subject_id);
    const teacherId = String(row.teacher_id);
    const roomId = String(row.room_id);
    const timeslotId = String(row.timeslot_id);
    const groupId = String(row.group_id);
    const key = `${subjectId}|${teacherId}|${roomId}|${timeslotId}`;
    if (!grouped.has(key)) {
      const subject = subjectById[subjectId] || {};
      grouped.set(key, {
        eventId: key,
        groupIds: [groupId],
        subjectId,
        subjectName: subject.subject_name || subjectId,
        teacherId,
        teacherName: (teacherById[teacherId] || {}).teacher_name || teacherId,
        roomId,
        roomName: (roomById[roomId] || {}).room_name || roomId,
        timeslotId,
        component: num(subject.practice) > 0 && num(subject.theory) === 0 ? 'practice' : 'theory',
        sharedEventId: null,
      });
    } else {
      const event = grouped.get(key);
      if (!event.groupIds.includes(groupId)) event.groupIds.push(groupId);
    }
  }

  const events = [...grouped.values()].map((event) => {
    if (event.groupIds.length > 1) event.sharedEventId = event.eventId;
    return event;
  });

  const timeslots = rows(tables, 'timeslot').map((t) => ({
    timeslotId: String(t.timeslot_id),
    day: dayNumber(t.day),
    period: num(t.period),
  }));

  return {
    scheduleId,
    datasetVersion,
    solverStatus,
    updatedAt: new Date().toISOString(),
    events,
    timeslots,
    data: scheduleRows || [],
  };
}

module.exports = { withHomeroom, rows, num, dayNumber, isLeader, buildSolverPayload, buildScheduleView, buildRoomLocks };
