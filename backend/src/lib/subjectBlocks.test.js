const test = require('node:test');
const assert = require('node:assert/strict');
const {validateSchedule} = require('./validateSchedule');

function validate(slots, rows=slots.map((_,index)=>({group_id:'G0',subject_id:'S0',timeslot_id:String(index)}))) {
  const tables={timeslot:slots.map(([day,period],index)=>({timeslot_id:String(index),day,period}))};
  return Object.fromEntries(validateSchedule({data:rows},tables).results.map(r=>[r.ruleId,r.status]));
}
test('consecutive blocks use period numbers, not CSV ordering, and may span days',()=>{
  const result=validate([[1,12],[2,2],[1,11],[2,1]]);
  assert.equal(result.C24,'pass'); assert.equal(result.C25,'pass');
});
test('gap, lunch and duplicate period fail consecutive validation',()=>{
  for(const periods of [[1,3],[4,6],[1,1]]) assert.equal(validate(periods.map(p=>[1,p])).C24,'fail');
});
test('period 12 is allowed, period 13 and missing slots fail',()=>{
  assert.equal(validate([[1,12]]).C25,'pass');
  for(const period of [13,0,-1,1.5]) assert.equal(validate([[1,period]]).C25,'fail');
  assert.equal(validate([],[{group_id:'G0',subject_id:'S0',timeslot_id:'missing'}]).C25,'fail');
});
test('same-subject blocks are checked separately for each group',()=>{
  const slots=[[1,1],[1,2],[1,3],[1,4]];
  const rows=slots.map((_,i)=>({group_id:i<2?'G0':'G1',subject_id:'S0',timeslot_id:String(i)}));
  assert.equal(validate(slots,rows).C24,'pass');
});
