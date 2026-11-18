const test=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');

const tables={teacher:[{teacher_id:'T0'}],room:[{room_id:'R0',room_type:'Theory'}],student_group:[{group_id:'G0'}],
 subject:[{subject_id:'S0',theory:1,practice:0}],teach:[{teacher_id:'T0',subject_id:'S0'}],register:[{group_id:'G0',subject_id:'S0'}],
 timeslot:[{timeslot_id:'L0',day:1,period:1},{timeslot_id:'L1',day:1,period:2}]};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn){for(let i=0;i<200;i++){const result=await fn();if(result)return result;await wait(30);}throw new Error('condition timed out');}

test('real backend restart resumes persisted job; 409 and cancellation stay explicit',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'timetable-test-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('timetable-test-'));fs.rmSync(directory,{recursive:true,force:true});});
 let complete=false,posts=[],deletes=0;
 const worker=http.createServer(async(req,res)=>{
  for await(const chunk of req){};
  res.setHeader('Content-Type','application/json');
  if(req.url==='/')return res.end(JSON.stringify({boot_id:'stable-worker'}));
  if(req.method==='DELETE'){deletes++;return res.end(JSON.stringify({status:'cancelled',boot_id:'stable-worker'}));}
  if(req.method==='POST')posts.push(req.headers['idempotency-key']);
  const result={status:'SUCCESS',solver_status:'FEASIBLE',schedule:[
   {group_id:'G0',subject_id:'S0',teacher_id:'T0',room_id:'R0',timeslot_id:'L0'},
   {group_id:'G0',subject_id:'HOMEROOM',teacher_id:'T0',room_id:'R0',timeslot_id:'L1'}],stats:{wallTimeSec:1},logs:[]};
  res.end(JSON.stringify({boot_id:'stable-worker',status:complete?'completed':'running',elapsed_seconds:1,queue_position:0,result:complete?result:undefined}));
 });
 await new Promise(resolve=>worker.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>worker.close(resolve)));
 const children=[];
 t.after(async()=>{for(const child of children)if(child.exitCode===null && !child.killed){child.kill();await new Promise(resolve=>child.once('exit',resolve));}});
 async function start(){
  const child=fork(path.join(__dirname,'../../test_support/job-server.js'),[],{silent:true,env:{...process.env,
   AI_WORKER_URL:`http://127.0.0.1:${worker.address().port}`,TEST_STATE_PATH:path.join(directory,'state.json')}});
  children.push(child);
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const info=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('exit',()=>reject(new Error('test backend exited before startup: '+stderr)));});
  return {child,url:`http://127.0.0.1:${info.port}/api`};
 }
 let backend=await start();
 const response=await fetch(backend.url+'/solve-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tables,timeLimitSeconds:60})});
 assert.equal(response.status,202);const job=await response.json();
 await waitFor(()=>posts.length===1);
 const duplicate=await fetch(backend.url+'/solve-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tables})});
 assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).jobId,job.jobId);
 backend.child.kill();await new Promise(resolve=>backend.child.once('exit',resolve));
 complete=true;backend=await start();
 const recovered=await waitFor(async()=>{const state=await(await fetch(backend.url+'/solve-jobs/'+job.jobId)).json();return state.status==='completed'?state:null;});
 assert.equal(recovered.solverStatus,'FEASIBLE');assert.equal(new Set(posts).size,1);
 const schedule=await(await fetch(backend.url+'/schedules/'+recovered.scheduleId)).json();assert.equal(schedule.data.length,2);
 complete=false;
 const next=await(await fetch(backend.url+'/solve-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tables})})).json();
 await waitFor(()=>posts.includes(next.jobId));
 const cancelled=await(await fetch(backend.url+'/solve-jobs/'+next.jobId+'/cancel',{method:'POST'})).json();
 assert.equal(cancelled.status,'cancelled');await waitFor(()=>deletes>0);
 const state=await(await fetch(backend.url+'/solve-jobs/'+next.jobId)).json();assert.equal(state.status,'cancelled');
});
