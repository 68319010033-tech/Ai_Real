const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const axios = require('axios');
const {WorkerClient} = require('./workerClient');
const {JobStore} = require('./jobStore');

async function stub(t, handler) {
  const server=http.createServer(async (req,res) => {
    let text=''; for await (const chunk of req) text+=chunk;
    try { await handler(req,res,text ? JSON.parse(text):null); }
    catch { res.writeHead(500);res.end('{}'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return new WorkerClient(axios,`http://127.0.0.1:${server.address().port}`,{pollMs:1,retryBase:1,timeout:1000,wakeTimeout:1000,retries:3});
}
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
const completed=(boot='boot')=>({boot_id:boot,status:'completed',result:{status:'SUCCESS',schedule:[]}});
const update=job=>async patch=>Object.assign(job,patch);

for (const status of [503,504,502]) test(`transient ${status} on POST and poll recovers with one job`,async t=>{
  let posts=0,polls=0,created=new Set();
  const client=await stub(t,(req,res)=>{
    if(req.url==='/') return send(res,200,{boot_id:'boot'});
    if(req.method==='POST') {
      created.add(req.headers['idempotency-key']);
      if(++posts===1) return send(res,status,{});
      return send(res,202,{boot_id:'boot',status:'running'});
    }
    if(++polls===1) return send(res,status,{});
    send(res,200,completed());
  });
  const job={jobId:'same'};
  assert.equal((await client.solve({},job,update(job))).status,'SUCCESS');
  assert.equal(created.size,1);assert.equal(posts,2);assert.equal(polls,2);
});

test('lost POST response retries same key without duplicate work',async t=>{
  const keys=new Set();let tries=0;
  const client=await stub(t,(req,res)=>{
    if(req.url==='/')return send(res,200,{boot_id:'boot'});
    keys.add(req.headers['idempotency-key']);
    if(++tries===1)return req.socket.destroy();
    send(res,202,completed());
  });
  const job={jobId:'lost-response'};
  assert.equal((await client.solve({},job,update(job))).status,'SUCCESS');
  assert.equal(keys.size,1);
});

test('cold start remains waking until health responds',async t=>{
  const states=[];
  const client=await stub(t,async(req,res)=>{
    if(req.url==='/') {await new Promise(r=>setTimeout(r,40));return send(res,200,{boot_id:'boot'});}
    send(res,202,completed());
  });
  const job={jobId:'cold'};
  const result=await client.solve({},job,async p=>{Object.assign(job,p);states.push(p);});
  assert.equal(result.status,'SUCCESS');assert.equal(states[0].message,'AI worker is waking up');
});

test('worker restart resubmits once and records FAILED attempt',async t=>{
  let boot='old',posts=0;
  const client=await stub(t,(req,res)=>{
    if(req.url==='/') return send(res,200,{boot_id:boot});
    if(req.method==='POST') {
      posts++;
      if(posts===1) {boot='new';return send(res,202,{boot_id:'old',status:'running'});}
      return send(res,202,completed('new'));
    }
    send(res,404,{boot_id:'new'});
  });
  const job={jobId:'restart'};
  assert.equal((await client.solve({},job,update(job))).status,'SUCCESS');
  assert.equal(posts,2);assert.equal(job.restartRetries,1);assert.equal(job.restartHistory[0].status,'FAILED');
});

test('second restart fails clearly; never retries indefinitely',async t=>{
  let boot=0;
  const client=await stub(t,(req,res)=>{
    if(req.url==='/')return send(res,200,{boot_id:String(boot)});
    if(req.method==='POST')return send(res,202,{boot_id:String(boot++),status:'running'});
    send(res,404,{});
  });
  const job={jobId:'twice'};
  await assert.rejects(client.solve({},job,update(job)),e=>e.code==='WORKER_RESTARTED' && e.message.includes('out-of-memory'));
  assert.equal(boot,2);
});

test('persistent gateway failure is a classified message',async t=>{
  const client=await stub(t,(req,res)=>send(res,503,{}));
  const job={jobId:'unavailable'};
  await assert.rejects(client.solve({},job,update(job)),e=>e.code==='WORKER_UNAVAILABLE' && !e.message.includes('status code'));
});

test('infeasible and UNKNOWN remain solver results; invalid input stays distinct',async t=>{
  let result={status:'INFEASIBLE',reason:'Room capacity conflict'};
  const client=await stub(t,(req,res)=>{
    if(req.url==='/')return send(res,200,{boot_id:'boot'});
    if(result.status==='INVALID')return send(res,422,{detail:'Invalid input'});
    send(res,202,{...completed(),result});
  });
  for(const status of ['INFEASIBLE','UNKNOWN']) {
    result={status};const job={jobId:status};assert.equal((await client.solve({},job,update(job))).status,status);
  }
  result={status:'INVALID'};const job={jobId:'invalid'};
  await assert.rejects(client.solve({},job,update(job)),e=>e.code==='INVALID_INPUT');
});

function fakeFirebase() {
  const state={};
  return {state,ref(path){return {
    orderByChild(){return this;},limitToLast(){return this;},
    async once(){return {val:()=>JSON.parse(JSON.stringify(state[path] || {}))};},
    async set(value){const [root,id]=path.split('/');state[root]||={};state[root][id]=JSON.parse(JSON.stringify(value));},
    async remove(){const [root,id]=path.split('/');delete state[root]?.[id];}
  };}};
}

test('backend restart loads running job and resumes same idempotency identity',async t=>{
  const db=fakeFirebase();const first=new JobStore(db);
  await first.save({jobId:'persist',uid:'u',status:'running',workerBootId:'boot',workerJobId:'persist',createdAt:new Date().toISOString()});
  const recovered=new JobStore(db);const [job]=await recovered.load();
  let key;
  const client=await stub(t,(req,res)=>{
    if(req.url==='/')return send(res,200,{boot_id:'boot'});
    key=req.headers['idempotency-key'];send(res,202,completed());
  });
  assert.equal((await client.solve({},job,async p=>{Object.assign(job,p);await recovered.save(job);})).status,'SUCCESS');
  assert.equal(key,'persist');assert.equal(recovered.activeFor('u').jobId,'persist');
});

test('TTL removes persisted terminal jobs, retains live jobs and bounds logs',async()=>{
  const db=fakeFirebase();const store=new JobStore(db,{ttlMs:1});
  await store.save({jobId:'old',status:'completed',completedAt:'2000-01-01',createdAt:'2000-01-01',logs:Array(120).fill({message:'a'})});
  await store.save({jobId:'live',uid:'u',status:'running',createdAt:'2000-01-01'});
  assert.equal(store.jobs.get('old').logs.length,100);
  await store.cleanup();assert.equal(store.jobs.size,1);assert.equal(db.state.aiJobs.old,undefined);
});

test('non-idempotent POST is refused',async()=>{
  const client=new WorkerClient({},'http://unused');
  await assert.rejects(client.request('post','/jobs'),e=>e.code==='INVALID_INPUT');
});
