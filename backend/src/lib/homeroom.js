// C11: every group needs a homeroom lesson each week. The CSV set has no
// homeroom subject, so one virtual subject is added at solve/validate time.
// The function is pure and idempotent; stored datasets are never modified.
const HOMEROOM_ID = 'HOMEROOM';

function isHomeroomSubject(s = {}) {
  return /homeroom|โฮมรูม|home\s*room/i.test(`${s.subject_id} ${s.subject_name}`);
}

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

function withHomeroom(tables, { enabled = process.env.AUTO_HOMEROOM !== 'false' } = {}) {
  if (!enabled || !tables) return tables;
  const subjects = tables.subject || [];
  const groups = tables.student_group || [];
  if (!groups.length || subjects.some(isHomeroomSubject)) return tables;

  const teachers = tables.teacher || [];
  const registers = [];
  const teach = [];
  for (const group of groups) {
    const gid = String(group.group_id);
    registers.push({ group_id: gid, subject_id: HOMEROOM_ID });
    // C19: advisor teaches their own homeroom. Match by teacher id or name.
    const advisor = norm(group.advisor);
    const match = advisor && teachers.find((t) => norm(t.teacher_id) === advisor || norm(t.teacher_name) === advisor);
    if (match) registers[registers.length - 1].teacher_id = String(match.teacher_id);
  }
  // Teach rows: advisors only when every group's advisor was resolved,
  // otherwise any teacher may take the homeroom (unmatched advisors).
  const advisors = [...new Set(registers.map((r) => r.teacher_id).filter(Boolean))];
  const allTeachers = registers.every((r) => r.teacher_id) ? advisors : teachers.map((t) => String(t.teacher_id));
  for (const tid of allTeachers) teach.push({ teacher_id: tid, subject_id: HOMEROOM_ID });

  return {
    ...tables,
    subject: [...subjects, { subject_id: HOMEROOM_ID, subject_name: 'โฮมรูม', theory: '1', practice: '0', credit: '0' }],
    register: [...(tables.register || []), ...registers],
    teach: [...(tables.teach || []), ...teach],
  };
}

module.exports = { withHomeroom, isHomeroomSubject, HOMEROOM_ID };
