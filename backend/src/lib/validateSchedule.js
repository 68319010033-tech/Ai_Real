const { rows, num, dayNumber, isLeader } = require('./dataset');

const RULES = [
  ['C01', 'จำนวนคาบรายวิชา = ทฤษฎี + ปฏิบัติ'],
  ['C02', 'ไม่มีเรียนคาบ 5'],
  ['C03', 'วิชาที่เรียนตรงกับที่ลงทะเบียน'],
  ['C04', 'คาบรวมเท่ากับผลรวมวิชาลงทะเบียน'],
  ['C05', 'เรียนไม่เกิน 10 คาบต่อวัน'],
  ['C06', 'ครูไม่สอนชนเวลา'],
  ['C07', 'ห้องไม่ถูกใช้ซ้อนเวลา'],
  ['C08', 'ครูสอนเฉพาะวิชาที่กำหนด'],
  ['C09', 'ประเภทห้องตรงกับวิชา'],
  ['C10', 'Leader ไม่สอนช่วงประชุมอังคารคาบ 8'],
  ['C11', 'มีโฮมรูมอย่างน้อยสัปดาห์ละ 1 คาบ'],
  ['C12', 'วิชากิจกรรมอยู่พุธคาบ 8–9'],
  ['C13', 'วิชา 20000/30000 เรียนร่วม 2 กลุ่ม'],
  ['C14', 'วิชา IOT ต้องใช้ห้อง R6201'],
  ['C15', 'วิชา Network/Server ต้องใช้ห้อง R6203'],
  ['C16', 'วิชา AI/software ต้องใช้ห้อง R6405'],
  ['C17', 'วิชา Graphic ต้องใช้ห้อง R6205'],
  ['C18', 'วิชาภาษาอังกฤษต้องใช้ห้อง R5204'],
];

function slotMap(tables) {
  const map = {};
  for (const t of rows(tables, 'timeslot')) {
    map[String(t.timeslot_id)] = { day: dayNumber(t.day), period: num(t.period) };
  }
  return map;
}

function expandEvents(schedule) {
  const events = schedule?.events || [];
  const out = [];
  for (const event of events) {
    const groups = event.groupIds?.length ? event.groupIds : [event.group_id].filter(Boolean);
    for (const groupId of groups) {
      out.push({
        groupId: String(groupId),
        subjectId: String(event.subjectId || event.subject_id),
        teacherId: String(event.teacherId || event.teacher_id),
        roomId: String(event.roomId || event.room_id),
        timeslotId: String(event.timeslotId || event.timeslot_id),
        subjectName: event.subjectName || '',
      });
    }
  }
  if (!out.length && Array.isArray(schedule?.data)) {
    for (const row of schedule.data) {
      out.push({
        groupId: String(row.group_id),
        subjectId: String(row.subject_id),
        teacherId: String(row.teacher_id),
        roomId: String(row.room_id),
        timeslotId: String(row.timeslot_id),
        subjectName: '',
      });
    }
  }
  return out;
}

function isHomeroom(subject) {
  const text = `${subject.subject_id} ${subject.subject_name}`.toLowerCase();
  return /homeroom|โฮมรูม|home\s*room/.test(text);
}

function isActivity(subject) {
  const text = `${subject.subject_id} ${subject.subject_name}`.toLowerCase();
  return /activity|กิจกรรม/.test(text) || String(subject.subject_id).toUpperCase().startsWith('ACT');
}

function isSharedCode(subjectId) {
  return /^(20000|30000)/.test(String(subjectId));
}

function result(ruleId, title, status, violations = []) {
  return { ruleId, title, status, violations };
}

function validateSchedule(schedule, tables, specialRules = []) {
  const events = expandEvents(schedule);
  const slots = slotMap(tables);
  const subjects = Object.fromEntries(rows(tables, 'subject').map((s) => [String(s.subject_id), s]));
  const rooms = Object.fromEntries(rows(tables, 'room').map((r) => [String(r.room_id), r]));
  const teachers = Object.fromEntries(rows(tables, 'teacher').map((t) => [String(t.teacher_id), t]));
  const teachPairs = new Set(rows(tables, 'teach').map((t) => `${t.teacher_id}|${t.subject_id}`));
  const registers = rows(tables, 'register').map((r) => ({
    groupId: String(r.group_id),
    subjectId: String(r.subject_id),
  }));
  const selected = new Set(specialRules);
  const out = [];

  const hoursOf = (subjectId) => {
    const s = subjects[subjectId] || {};
    return num(s.theory) + num(s.practice);
  };

  {
    const violations = [];
    for (const reg of registers) {
      const got = events.filter((e) => e.groupId === reg.groupId && e.subjectId === reg.subjectId).length;
      const need = hoursOf(reg.subjectId);
      if (got !== need) {
        violations.push({
          message: `กลุ่ม ${reg.groupId} วิชา ${reg.subjectId} ได้ ${got} คาบ ต้องได้ ${need} คาบ`,
          groupIds: [reg.groupId],
        });
      }
    }
    out.push(result('C01', RULES[0][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = events
      .filter((e) => (slots[e.timeslotId]?.period || 0) === 5)
      .map((e) => ({
        message: `มีเรียนคาบ 5 ของกลุ่ม ${e.groupId}`,
        groupIds: [e.groupId],
        timeslotId: e.timeslotId,
      }));
    out.push(result('C02', RULES[1][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const allowed = new Set(registers.map((r) => `${r.groupId}|${r.subjectId}`));
    const violations = [];
    for (const e of events) {
      if (!allowed.has(`${e.groupId}|${e.subjectId}`)) {
        violations.push({
          message: `กลุ่ม ${e.groupId} เรียนวิชา ${e.subjectId} ที่ไม่ได้ลงทะเบียน`,
          groupIds: [e.groupId],
        });
      }
    }
    out.push(result('C03', RULES[2][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = [];
    const groups = [...new Set(registers.map((r) => r.groupId))];
    for (const groupId of groups) {
      const need = registers.filter((r) => r.groupId === groupId).reduce((sum, r) => sum + hoursOf(r.subjectId), 0);
      const got = events.filter((e) => e.groupId === groupId).length;
      if (got !== need) {
        violations.push({ message: `กลุ่ม ${groupId} มี ${got} คาบ ต้องมี ${need} คาบ`, groupIds: [groupId] });
      }
    }
    out.push(result('C04', RULES[3][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = [];
    const counts = {};
    for (const e of events) {
      const slot = slots[e.timeslotId];
      if (!slot) continue;
      const key = `${e.groupId}|${slot.day}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(counts)) {
      if (count > 10) {
        const [groupId, day] = key.split('|');
        violations.push({ message: `กลุ่ม ${groupId} วัน ${day} มี ${count} คาบ`, groupIds: [groupId] });
      }
    }
    out.push(result('C05', RULES[4][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = [];
    const seen = {};
    for (const e of events) {
      const key = `${e.teacherId}|${e.timeslotId}`;
      // รวมกลุ่มเป็นคาบเดียวได้เฉพาะวิชา 20000/30000 วิชาอื่นนับแยกตามกลุ่ม
      const classKey = `${e.subjectId}|${e.roomId}` + (isSharedCode(e.subjectId) ? '' : `|${e.groupId}`);
      if (!seen[key]) seen[key] = classKey;
      else if (seen[key] !== classKey) {
        violations.push({
          message: `ครู ${e.teacherId} สอนชนกันที่คาบ ${e.timeslotId}`,
          teacherId: e.teacherId,
          timeslotId: e.timeslotId,
        });
      }
    }
    out.push(result('C06', RULES[5][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = [];
    const seen = {};
    for (const e of events) {
      const key = `${e.roomId}|${e.timeslotId}`;
      const classKey = `${e.subjectId}|${e.teacherId}` + (isSharedCode(e.subjectId) ? '' : `|${e.groupId}`);
      if (!seen[key]) seen[key] = classKey;
      else if (seen[key] !== classKey) {
        violations.push({
          message: `ห้อง ${e.roomId} ถูกใช้ซ้อนที่คาบ ${e.timeslotId}`,
          roomId: e.roomId,
          timeslotId: e.timeslotId,
        });
      }
    }
    out.push(result('C07', RULES[6][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = [];
    if (teachPairs.size) {
      for (const e of events) {
        if (!teachPairs.has(`${e.teacherId}|${e.subjectId}`)) {
          violations.push({
            message: `ครู ${e.teacherId} ไม่ได้อยู่ใน teach ของวิชา ${e.subjectId}`,
            teacherId: e.teacherId,
          });
        }
      }
    }
    out.push(result('C08', RULES[7][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = [];
    for (const e of events) {
      const subject = subjects[e.subjectId] || {};
      const room = rooms[e.roomId] || {};
      const roomType = String(room.room_type || '').toLowerCase();
      const theoryOnly = num(subject.theory) > 0 && num(subject.practice) === 0;
      const hasPractice = num(subject.practice) > 0;
      if (theoryOnly && roomType && roomType !== 'theory') {
        violations.push({
          message: `วิชาทฤษฎี ${e.subjectId} ถูกจัดในห้อง ${e.roomId} (${room.room_type})`,
          roomId: e.roomId,
        });
      }
      if (hasPractice && roomType === 'theory') {
        violations.push({
          message: `วิชาที่มีปฏิบัติ ${e.subjectId} ถูกจัดในห้อง Theory ${e.roomId}`,
          roomId: e.roomId,
        });
      }
    }
    out.push(result('C09', RULES[8][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const violations = [];
    for (const e of events) {
      const teacher = teachers[e.teacherId] || {};
      const slot = slots[e.timeslotId] || {};
      if (isLeader(teacher.role) && slot.day === 2 && slot.period === 8) {
        violations.push({
          message: `ครู Leader ${e.teacherId} สอนอังคารคาบ 8`,
          teacherId: e.teacherId,
          timeslotId: e.timeslotId,
        });
      }
    }
    out.push(result('C10', RULES[9][1], violations.length ? 'fail' : 'pass', violations));
  }

  {
    const homeroomIds = Object.values(subjects).filter(isHomeroom).map((s) => String(s.subject_id));
    if (!homeroomIds.length) {
      out.push(result('C11', RULES[10][1], 'unresolved', []));
    } else {
      const groups = [...new Set(rows(tables, 'student_group').map((g) => String(g.group_id)))];
      const violations = groups
        .filter((groupId) => !events.some((e) => e.groupId === groupId && homeroomIds.includes(e.subjectId)))
        .map((groupId) => ({ message: `กลุ่ม ${groupId} ไม่มีคาบโฮมรูม`, groupIds: [groupId] }));
      out.push(result('C11', RULES[10][1], violations.length ? 'fail' : 'pass', violations));
    }
  }

  {
    const activityIds = new Set(Object.values(subjects).filter(isActivity).map((s) => String(s.subject_id)));
    if (!activityIds.size) {
      out.push(result('C12', RULES[11][1], 'unresolved', []));
    } else {
      const violations = [];
      for (const e of events) {
        const slot = slots[e.timeslotId] || {};
        const activitySlot = slot.day === 3 && (slot.period === 8 || slot.period === 9);
        if (activityIds.has(e.subjectId) && !activitySlot) {
          violations.push({
            message: `วิชากิจกรรม ${e.subjectId} ไม่อยู่พุธคาบ 8–9`,
            groupIds: [e.groupId],
            timeslotId: e.timeslotId,
          });
        }
        if (!activityIds.has(e.subjectId) && activitySlot) {
          violations.push({
            message: `วิชา ${e.subjectId} ถูกจัดในช่องกิจกรรมพุธคาบ 8–9`,
            groupIds: [e.groupId],
            timeslotId: e.timeslotId,
          });
        }
      }
      out.push(result('C12', RULES[11][1], violations.length ? 'fail' : 'pass', violations));
    }
  }

  {
    const sharedRegs = registers.filter((r) => isSharedCode(r.subjectId));
    if (!sharedRegs.length) {
      out.push(result('C13', RULES[12][1], 'unresolved', []));
    } else {
      const bySubject = {};
      for (const r of sharedRegs) {
        bySubject[r.subjectId] = bySubject[r.subjectId] || new Set();
        bySubject[r.subjectId].add(r.groupId);
      }
      const violations = [];
      for (const [subjectId, groupSet] of Object.entries(bySubject)) {
        const groups = [...groupSet];
        if (groups.length < 2) continue;
        const bySlot = {};
        for (const e of events.filter((x) => x.subjectId === subjectId)) {
          const key = `${e.timeslotId}|${e.roomId}|${e.teacherId}`;
          bySlot[key] = bySlot[key] || new Set();
          bySlot[key].add(e.groupId);
        }
        for (const [key, present] of Object.entries(bySlot)) {
          if (present.size === 1) {
            const [timeslotId] = key.split('|');
            violations.push({
              message: `วิชา ${subjectId} ที่คาบ ${timeslotId} มีแค่กลุ่ม ${[...present].join(', ')} ไม่ได้เรียนร่วม`,
              groupIds: [...present],
              timeslotId,
            });
          }
        }
      }
      out.push(result('C13', RULES[12][1], violations.length ? 'fail' : 'pass', violations));
    }
  }

  const extra = [
    ['C14', 'R6201', (s) => /iot/i.test(`${s.subject_id} ${s.subject_name}`)],
    ['C15', 'R6203', (s) => ['31901-2002', '31900-0004'].includes(String(s.subject_id))],
    ['C16', 'R6405', (s) => ['31901-2006', '31901-2009'].includes(String(s.subject_id))],
    ['C17', 'R6205', (s) => String(s.subject_id) === '21901-2010'],
    ['C18', 'R5204', (s) => /30000-1202|english|อังกฤษ/i.test(`${s.subject_id} ${s.subject_name}`)],
  ];
  for (const [ruleId, roomId, match] of extra) {
    const title = RULES.find((r) => r[0] === ruleId)?.[1] || ruleId;
    if (!selected.has(ruleId)) {
      out.push(result(ruleId, title, 'inactive', []));
      continue;
    }
    const ids = new Set(Object.values(subjects).filter(match).map((s) => String(s.subject_id)));
    if (!ids.size) {
      out.push(result(ruleId, title, 'unresolved', []));
      continue;
    }
    const violations = events
      .filter((e) => ids.has(e.subjectId) && e.roomId !== roomId)
      .map((e) => ({
        message: `วิชา ${e.subjectId} ถูกจัดห้อง ${e.roomId} ต้องเป็น ${roomId}`,
        roomId: e.roomId,
      }));
    out.push(result(ruleId, title, violations.length ? 'fail' : 'pass', violations));
  }

  return {
    scheduleId: schedule?.scheduleId,
    results: out,
  };
}

module.exports = { validateSchedule };