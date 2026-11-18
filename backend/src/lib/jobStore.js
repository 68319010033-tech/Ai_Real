// Bounded job state, with optional Firebase persistence. Never persist controllers.
const TERMINAL = new Set(['completed','failed','cancelled']);
class JobStore {
  constructor(db, {ttlMs=86400000, cap=200, path='aiJobs'} = {}) {
    this.db=db; this.ttlMs=ttlMs; this.cap=cap; this.path=path; this.jobs=new Map(); this.pending=new Map();
  }
  async load() {
    if (this.db) {
      const snapshot = await this.db.ref(this.path).orderByChild('createdAt').limitToLast(this.cap).once('value');
      for (const [id,job] of Object.entries(snapshot.val() || {})) this.jobs.set(id,job);
    }
    await this.cleanup();
    return [...this.jobs.values()].filter(j => !TERMINAL.has(j.status));
  }
  async save(job) {
    job.logs = (job.logs || []).slice(-100);
    if (TERMINAL.has(job.status) && !job.completedAt) job.completedAt = new Date().toISOString();
    const record=JSON.parse(JSON.stringify(job));
    this.jobs.set(job.jobId,job);
    const previous=this.pending.get(job.jobId) || Promise.resolve();
    const write=previous.catch(()=>{}).then(async()=>{
      if (this.db) await this.db.ref(this.path+'/'+job.jobId).set(record);
    });
    this.pending.set(job.jobId,write);
    try { await write; } finally { if(this.pending.get(job.jobId)===write) this.pending.delete(job.jobId); }
  }

  async cleanup() {
    const now=Date.now();
    for (const [id,job] of this.jobs) {
      if (TERMINAL.has(job.status) && now-Date.parse(job.completedAt || job.createdAt)>this.ttlMs) {
        if (this.db) await this.db.ref(this.path+'/'+id).remove();
        this.jobs.delete(id);
      }
    }
  }
  activeFor(uid) { return [...this.jobs.values()].find(j => j.uid===uid && !TERMINAL.has(j.status)); }
}
module.exports = {JobStore, TERMINAL};
