// Isolated synthetic test harness: substitutes Firebase/auth before route loading.
// Does not import application credential initialization or read any secret file.
const fs=require('node:fs');
const express=require('express');
const statePath=process.env.TEST_STATE_PATH;
const read=()=>fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{};
const db={ref(path){return {
  orderByChild(){return this;},limitToLast(){return this;},
  async once(){const state=read();const value=state[path] ?? Object.fromEntries(Object.entries(state).filter(([key])=>key.startsWith(path+'/')).map(([key,val])=>[key.slice(path.length+1),val]));return {val:()=>value};},
  async set(value){const state=read();state[path]=value;fs.writeFileSync(statePath,JSON.stringify(state));},
  async remove(){const state=read();delete state[path];fs.writeFileSync(statePath,JSON.stringify(state));}
};}};
const firebase=require.resolve('../src/config/firebase');
require.cache[firebase]={id:firebase,filename:firebase,loaded:true,exports:{db}};
const auth=require.resolve('../src/middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:(req,res,next)=>{req.user={uid:'synthetic-user'};next();}};
const app=express();app.use(express.json());app.use('/api',require('../src/routes/schedule'));
const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
