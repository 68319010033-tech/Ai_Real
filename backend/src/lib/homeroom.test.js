const test = require('node:test');
const assert = require('node:assert');
const { withHomeroom } = require('./homeroom');

const base = () => ({
  teacher: [{ teacher_id: 'T1', teacher_name: 'Somchai' }, { teacher_id: 'T2', teacher_name: 'Malee' }],
  student_group: [{ group_id: 'G1', advisor: 'somchai' }, { group_id: 'G2', advisor: 'T2' }],
  subject: [{ subject_id: 'S1', subject_name: 'Math', theory: '1', practice: '0' }],
  register: [{ group_id: 'G1', subject_id: 'S1' }],
  teach: [{ teacher_id: 'T1', subject_id: 'S1' }],
});

test('adds one homeroom per group taught by the matched advisor', () => {
  const out = withHomeroom(base(), { enabled: true });
  assert.equal(out.register.filter((r) => r.subject_id === 'HOMEROOM').length, 2);
  assert.deepEqual(out.teach.filter((t) => t.subject_id === 'HOMEROOM').map((t) => t.teacher_id).sort(), ['T1', 'T2']);
  assert.equal(out.subject.at(-1).theory, '1');
});

test('unmatched advisor opens homeroom to all teachers', () => {
  const t = base();
  t.student_group[1].advisor = 'nobody';
  const out = withHomeroom(t, { enabled: true });
  assert.equal(out.teach.filter((x) => x.subject_id === 'HOMEROOM').length, 2);
});

test('idempotent, disableable, original untouched', () => {
  const t = base();
  const once = withHomeroom(t, { enabled: true });
  assert.equal(withHomeroom(once, { enabled: true }), once);
  assert.equal(withHomeroom(t, { enabled: false }), t);
  assert.equal(t.subject.length, 1);
});
