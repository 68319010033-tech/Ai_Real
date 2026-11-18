const test=require('node:test');
const assert=require('node:assert/strict');
const {WorkerClient}=require('./workerClient');
test('bounded queue exhaustion has its own class',async()=>{
 const client=new WorkerClient({request:async()=>{throw {response:{status:429,data:{}}};}},'http://unused',{retries:0});
 await assert.rejects(client.request('post','/jobs',{key:'id'}),e=>e.code==='QUEUE_FULL');
});
test('expired total budget stops without submitting new work',async()=>{
 let posts=0;
 const client=new WorkerClient({request:async({method})=>{if(method==='post')posts++;return {data:{status:'cancelled'}};}},'http://unused',{totalMs:1});
 const job={jobId:'expired',createdAt:'2000-01-01T00:00:00.000Z'};
 await assert.rejects(client.solve({},job,async patch=>Object.assign(job,patch)),e=>e.code==='JOB_WAIT_LIMIT');
 assert.equal(posts,0);
});
