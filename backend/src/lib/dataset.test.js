const test=require('node:test');
const assert=require('node:assert/strict');
const {withHomeroom,buildSolverPayload,buildRoomLocks}=require('./dataset');
const {validateSchedule}=require('./validateSchedule');
test('homeroom builder is non-mutating, idempotent and adds one registration per group',()=>{
 const original={subject:[],teach:[],register:[],teacher:[{teacher_id:'T1'}],student_group:[{group_id:'G1',advisor_id:'T1'},{group_id:'G2'}]};
 const tables=withHomeroom(original);
 assert.equal(original.register.length,0);assert.equal(tables.register.length,2);
 assert.deepEqual(withHomeroom(tables),tables);
 const payload=buildSolverPayload(tables,['C19']);assert.equal(payload.student_groups[0].advisor_id,'T1');
 assert.equal(payload.constraints.roomTypeMatch,true);
});
test('Thai IOT names select exactly the same locks as validator',()=>{
 const tables={subject:[{subject_id:'s',subject_name:'ระบบไอโอที',theory:1,practice:0}],room:[{room_id:'wrong'}],register:[],student_group:[],teacher:[],teach:[],timeslot:[]};
 assert.equal(buildRoomLocks(tables,['C14'])[0].room_id,'R6201');
 const result=validateSchedule({data:[{subject_id:'s',group_id:'g',teacher_id:'t',room_id:'wrong',timeslot_id:'x'}]},tables,['C14']);
 assert.equal(result.results.find(r=>r.ruleId==='C14').status,'fail');
});
