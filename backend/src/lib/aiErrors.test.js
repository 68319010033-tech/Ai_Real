const test = require('node:test');
const assert = require('node:assert/strict');
const { aiError } = require('./aiErrors');
test('gateway failures stay distinct from solver infeasibility', () => {
  for (const status of [502, 504]) {
    const result = aiError({response:{status,data:'private proxy body'}});
    assert.equal(result.code, 'AI_GATEWAY_ERROR');
    assert.ok(result.message.includes(String(status)));
    assert.ok(!result.message.includes('private proxy body'));
  }
});
test('busy worker and request timeout have separate messages', () => {
  assert.equal(aiError({response:{status:503}}).code,'AI_BUSY_OR_UNAVAILABLE');
  assert.equal(aiError({code:'ECONNABORTED'}).code,'AI_REQUEST_TIMEOUT');
});
test('invalid request is not treated as infeasible and structured detail is safe', () => {
  const result = aiError({response:{status:400,data:{detail:[{input:'private'}]}}});
  assert.equal(result.code,'AI_REQUEST_FAILED');
  assert.equal(typeof result.message,'string');
  assert.ok(!result.message.includes('private'));
});
