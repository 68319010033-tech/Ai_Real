const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSolverPayload, buildScheduleView } = require('./dataset');
const { validateSchedule } = require('./validateSchedule');

const sid = '30000-1201';
const tables = {
  register: ['G3', 'G4', 'G5'].map((group_id) => ({ group_id, subject_id: sid })),
  subject: [{ subject_id: sid, theory: 1, practice: 0 }],
  teacher: [{ teacher_id: 'T0' }],
  teach: [{ teacher_id: 'T0', subject_id: sid }],
  room: [{ room_id: 'R0', room_type: 'Theory' }],
  timeslot: [{ timeslot_id: 'L0', day: 'Mon', period: 1 }, { timeslot_id: 'L1', day: 'Mon', period: 2 }],
};
function check(groups, storedPolicy) {
  const rows = groups.map(([group_id, timeslot_id]) => ({ group_id, timeslot_id, subject_id: sid, teacher_id: 'T0', room_id: 'R0' }));
  const schedule = buildScheduleView('test', 'FEASIBLE', 'test', rows, tables);
  schedule.constraints = storedPolicy || buildSolverPayload(tables).constraints;
  return Object.fromEntries(validateSchedule(schedule, tables).results.map((r) => [r.ruleId, r.status]));
}
test('payload contains exactly the approved G3/G4 pair', () => {
  const policy = buildSolverPayload(tables).constraints;
  assert.equal(policy.jointMode, 'pairs');
  assert.deepEqual(policy.jointPairs, { [sid]: [['G3', 'G4']] });
});
test('approved pair plus separate G5 passes C06, C07 and C13', () => {
  const result = check([['G3','L0'], ['G4','L0'], ['G5','L1']]);
  for (const id of ['C06','C07','C13']) assert.equal(result[id], 'pass');
});
test('incorrect pair and triple class are rejected', () => {
  for (const rows of [ [['G3','L0'], ['G5','L0'], ['G4','L1']], [['G3','L0'], ['G4','L0'], ['G5','L0']] ]) {
    const result = check(rows);
    for (const id of ['C06','C07','C13']) assert.equal(result[id], 'fail');
  }
});
test('separating an approved pair fails C13', () => {
  assert.equal(check([['G3','L0'], ['G4','L1'], ['G5','L1']]).C13, 'fail');
});
test('validator uses saved policy rather than current defaults', () => {
  assert.equal(check([['G3','L0'], ['G4','L0'], ['G5','L1']], {jointMode:'pairs',jointPairs:{}}).C13, 'fail');
});
test('G7 singleton has no forced partner', () => {
  const data = { ...tables, register: [{group_id:'G7',subject_id:'20000-1208'}] };
  assert.deepEqual(buildSolverPayload(data).constraints.jointPairs, {});
});
