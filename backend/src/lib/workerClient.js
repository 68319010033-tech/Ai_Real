const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(Object.assign(new Error('Job cancelled'), {code:'CANCELLED'}));
  const onAbort = () => { clearTimeout(timer); reject(Object.assign(new Error('Job cancelled'), {code:'CANCELLED'})); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, {once:true});
});

class WorkerFailure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const transient = error => [429,502,503,504].includes(error?.response?.status)
  || (!error?.response && error?.code !== 'CANCELLED' && error?.code !== 'ERR_CANCELED');

class WorkerClient {
  constructor(http, url, options = {}) {
    this.http = http;
    this.url = url.replace(/\/$/, '');
    this.pollMs = options.pollMs ?? 2500;
    this.retryBase = options.retryBase ?? 1000;
    this.retries = options.retries ?? 5;
    this.timeout = options.timeout ?? 10000;
    this.wakeTimeout = options.wakeTimeout ?? 90000;
    this.totalMs = options.totalMs ?? 900000;
  }
  async request(method, path, {data, key, signal, timeout, deadline} = {}) {
    if (method === 'post' && !key) throw new WorkerFailure('INVALID_INPUT', 'Worker POST requires an idempotency key.');
    for (let attempt=0;;attempt++) {
      if (signal?.aborted) throw new WorkerFailure('CANCELLED', 'Job cancelled.');
      if (deadline && Date.now() >= deadline) throw new WorkerFailure('JOB_WAIT_LIMIT','AI job exceeded the total queue/solve wait limit.');
      try {
        return (await this.http.request({method, url:this.url+path, data, signal,
          timeout: Math.max(1, Math.min(timeout ?? this.timeout, deadline ? deadline-Date.now() : Infinity)),
          headers: key ? {'Idempotency-Key':key,'X-Request-ID':key} : {}})).data;
      } catch (error) {
        if (signal?.aborted || error.code === 'ERR_CANCELED') throw new WorkerFailure('CANCELLED','Job cancelled.');
        if (!transient(error) || attempt >= this.retries) {
          if (error.response?.status === 429) throw new WorkerFailure('QUEUE_FULL', 'AI worker queue or result-retention capacity is full. Wait for current jobs or retained results to expire, then retry.');
          if (error.response?.status === 404) throw new WorkerFailure('WORKER_RESTARTED', 'Worker job was lost or expired; worker may have restarted (possible out-of-memory).');
          if ([400,413,422].includes(error.response?.status)) throw new WorkerFailure('INVALID_INPUT', typeof error.response.data?.detail === 'string' ? error.response.data.detail : 'Worker rejected invalid or oversized input.');
          if (error.response?.status === 409) throw new WorkerFailure('IDEMPOTENCY_CONFLICT', 'Worker job key conflicts with a different request.');
          throw new WorkerFailure('WORKER_UNAVAILABLE', 'AI worker is temporarily unavailable after bounded retries. Please retry; this is not an infeasible timetable.');
        }
        await delay(Math.max(1, Math.min(this.retryBase * 2**attempt, 10000, deadline ? deadline-Date.now() : Infinity)), signal);
      }
    }
  }
  async cancel(job) {
    const key = job.workerJobId || job.jobId;
    try { await this.request('delete', '/jobs/'+encodeURIComponent(key), {key}); }
    catch (error) { if (error.code !== 'WORKER_RESTARTED') throw error; }
  }
  async solve(payload, job, update, signal) {
    const deadline = Date.parse(job.createdAt || new Date().toISOString()) + this.totalMs;
    while (true) {
      try {
        await update({status:'waking', message:'AI worker is waking up'});
        const health = await this.request('get','/',{signal,timeout:this.wakeTimeout,key:job.jobId,deadline});
        if (!health.boot_id) throw new WorkerFailure('WORKER_VERSION', 'AI worker must be upgraded to the async job API.');
        if (job.workerBootId && job.workerBootId !== health.boot_id) throw new WorkerFailure('WORKER_RESTARTED','AI worker restarted (possible out-of-memory); the previous solve was lost.');
        const key = job.workerJobId || job.jobId;
        // Persist identity before POST: a lost response or backend restart retries the same key.
        await update({workerJobId:key, workerBootId:health.boot_id});
        let remote = await this.request('post','/jobs',{data:payload,key,signal,deadline});
        while (true) {
          if (Date.now() >= deadline) throw new WorkerFailure('JOB_WAIT_LIMIT','AI job exceeded the total queue/solve wait limit.');
          if (remote.boot_id !== job.workerBootId) throw new WorkerFailure('WORKER_RESTARTED','AI worker restarted (possible out-of-memory); the previous solve was lost.');
          await update({status:remote.status === 'completed' ? 'running' : remote.status,
            queuePosition:remote.queue_position || 0, elapsedSeconds:remote.elapsed_seconds,
            message:remote.status === 'queued' ? 'Waiting in AI worker queue' : 'AI worker is solving',
            logs:remote.logs || []});
          if (remote.status === 'completed') return remote.result;
          if (remote.status === 'failed') throw new WorkerFailure(remote.error_code || 'WORKER_FAILED', remote.error || 'Solver process failed.');
          if (remote.status === 'cancelled') throw new WorkerFailure('CANCELLED','Job cancelled by worker.');
          await delay(this.pollMs, signal);
          remote = await this.request('get','/jobs/'+encodeURIComponent(key),{signal,key,deadline});
        }
      } catch (error) {
        if (error.code === 'WORKER_RESTARTED' && !job.restartRetries && job.autoResubmit !== false && !signal?.aborted) {
          await update({errorCode:error.code, error:error.message,
            restartHistory:[{status:'FAILED',code:error.code,message:error.message,at:new Date().toISOString()}]});
          await update({restartRetries:1, workerBootId:null, workerJobId:job.jobId+'-retry1',
            status:'queued', message:'Worker restarted; automatically resubmitting once', error:null, errorCode:null});
          continue;
        }
        if (['JOB_WAIT_LIMIT','CANCELLED','WORKER_UNAVAILABLE'].includes(error.code)) {
          try { await this.cancel(job); } catch { /* Failure remains explicit; identity is retained for later cancellation. */ }
        }
        throw error;
      }
    }
  }
}
module.exports = {WorkerClient, WorkerFailure, delay};
