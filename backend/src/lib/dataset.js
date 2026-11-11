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

  add('C14', 'R6201', (s) => /iot/i.test(`${s.subject_id} ${s.subject_name}`));
  add('C15', 'R6203', (s) => ['31901-2002', '31900-0004'].includes(String(s.subject_id)));
  add('C16', 'R6405', (s) => ['31901-2006', '31901-2009'].includes(String(s.subject_id)));
  add('C17', 'R6205', (s) => String(s.subject_id) === '21901-2010');
  add('C18', 'R5204', (s) => /30000-1202|english|อังกฤษ/i.test(`${s.subject_id} ${s.subject_name}`));
  return locks;
}

function buildSolverPayload(tables, specialRules = [], timeLimitSeconds = 60) {
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
  }));

  const subjects = rows(tables, 'subject').map((s) => ({
    subject_id: String(s.subject_id),
    subject_name: s.subject_name,
    theory_hours: num(s.theory),
    practice_hours: num(s.practice),
    credit: num(s.credit),
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
    room_locks: buildRoomLocks(tables, specialRules),
    time_limit_seconds: Number(timeLimitSeconds) || 60,
  };
}

function buildScheduleView(scheduleId, solverStatus, datasetVersion, scheduleRows, tables) {
  const subjectById = Object.fromEntries(
    rows(tables, 'subject').map((s) => [String(s.subject_id), s]),
  );
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
        roomId,
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

module.exports = { rows, num, dayNumber, isLeader, buildSolverPayload, buildScheduleView, buildRoomLocks };
