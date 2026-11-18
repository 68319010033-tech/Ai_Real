"""Single-consumer, bounded process-isolated jobs; no solver imports in server."""
import asyncio
from collections import OrderedDict
import hashlib
import json
import logging
import multiprocessing as mp
import os
import sys
import time
from uuid import uuid4
from memory_usage import memory_mb

TERMINAL = {'completed', 'failed', 'cancelled'}
logger = logging.getLogger('uvicorn.error')


def child_solve(payload, sender, address_limit_mb):
    try:
        if os.name == 'posix' and address_limit_mb:
            import resource
            ceiling = address_limit_mb * 1048576
            resource.setrlimit(resource.RLIMIT_AS, (ceiling, ceiling))
        from solver import solve_timetable
        sender.send({'kind': 'progress', 'message': 'Solver imported; building timetable model'})
        result = solve_timetable(payload)
        sender.send({'kind': 'result', 'result': result, 'peak_rss_mb': memory_mb(peak=True)})
    except MemoryError:
        sender.send({'kind': 'error', 'code': 'MEMORY_LIMIT', 'message': 'Solve exceeded its memory limit.'})
    except Exception as error:
        sender.send({'kind': 'error', 'code': 'COMPUTATION_ERROR', 'message': f'Solver failed ({type(error).__name__}); inspect worker logs.'})
    finally:
        sender.close()


class JobError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class JobManager:
    def __init__(self, *, ttl=None, cap=None, queue_limit=None, target=child_solve):
        if os.name == 'nt':
            mp.set_executable(sys._base_executable)  # Monitor the real child, not the venv launcher.
        self.boot_id = uuid4().hex
        self.jobs = OrderedDict()
        self.ttl = ttl if ttl is not None else int(os.getenv('AI_JOB_TTL_SECONDS', '1800'))
        self.cap = cap if cap is not None else int(os.getenv('AI_JOB_CAP', '100'))
        self.queue_limit = queue_limit if queue_limit is not None else int(os.getenv('AI_QUEUE_LIMIT', '4'))
        self.queue_wait = float(os.getenv('AI_QUEUE_WAIT_SECONDS', '600'))
        self.memory_limit = int(os.getenv('AI_JOB_MEMORY_MB', '320'))
        self.address_limit = int(os.getenv('AI_JOB_ADDRESS_MB', '384'))
        self.wall_limit = float(os.getenv('AI_JOB_WALL_SECONDS', '150'))
        self.target = target
        self.process = self.active = self.task = None
        self.closing = False
        for key in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
            os.environ[key] = '1'
        os.environ.setdefault('MALLOC_ARENA_MAX', '2')

    def cleanup(self):
        now = time.monotonic()
        for key, job in list(self.jobs.items()):
            if job['status'] in TERMINAL and now - job['finished'] > self.ttl:
                del self.jobs[key]

    def submit(self, payload, key, request_id):
        self.cleanup()
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        if key in self.jobs:
            if self.jobs[key]['digest'] is not None and self.jobs[key]['digest'] != digest:
                raise JobError(409, 'Idempotency key already belongs to a different payload.')
            return self.view(key)
        if self.closing:
            raise JobError(429, 'Worker shutting down; retry the same idempotency key.')
        if sum(j['status'] not in TERMINAL for j in self.jobs.values()) >= self.queue_limit + 1:
            raise JobError(429, 'Worker queue is full; retry the same idempotency key.')
        if len(self.jobs) >= self.cap:
            raise JobError(429, 'Job retention capacity reached; retry after results expire.')
        self.jobs[key] = {'id': key, 'digest': digest, 'payload': payload, 'status': 'queued',
                          'created': time.monotonic(), 'request_id': request_id, 'logs': [], 'peak_rss_mb': 0.0}
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.consume())
        return self.view(key)

    def view(self, key):
        self.cleanup()
        job = self.jobs.get(key)
        if not job:
            raise JobError(404, 'Job unknown or expired; worker may have restarted (possible out-of-memory).')
        queue = [k for k, j in self.jobs.items() if j['status'] == 'queued']
        return {k: v for k, v in job.items() if k not in {'payload', 'digest', 'created', 'started', 'finished'}} | {
            'boot_id': self.boot_id, 'queue_position': queue.index(key) + 1 if key in queue else 0,
            'elapsed_seconds': round(job.get('finished', time.monotonic()) - job['created'], 3)}

    def finish(self, job, status, code=None, message=None):
        job.update(status=status, finished=time.monotonic())
        job.pop('payload', None)
        if code:
            job.update(error_code=code, error=message)
        logger.info(json.dumps({'event': 'job_end', 'request_id': job['request_id'], 'job_id': job['id'],
                                'status': status, 'code': code, 'peak_rss_mb': round(job['peak_rss_mb'], 2),
                                'elapsed_seconds': round(job['finished'] - job['created'], 3)}))

    def cancel(self, key):
        self.cleanup()
        if key not in self.jobs:
            if len(self.jobs) >= self.cap:
                raise JobError(429, 'Job retention capacity reached; cancellation cannot be recorded.')
            self.jobs[key] = {'id':key, 'digest':None, 'status':'cancelled', 'created':time.monotonic(),
                              'finished':time.monotonic(), 'request_id':key, 'logs':[], 'peak_rss_mb':0.0,
                              'error_code':'CANCELLED', 'error':'Cancelled before submission was accepted.'}
        self.view(key)
        job = self.jobs[key]
        if job['status'] not in TERMINAL:
            self.finish(job, 'cancelled', 'CANCELLED', 'Job cancelled.')
            if key == self.active and self.process and self.process.is_alive():
                self.process.kill()
        return self.view(key)

    async def consume(self):
        while not self.closing:
            job = next((j for j in self.jobs.values() if j['status'] == 'queued'), None)
            if job is None:
                return
            if time.monotonic() - job['created'] > self.queue_wait:
                self.finish(job, 'failed', 'QUEUE_TIMEOUT', 'Queue wait limit reached; please retry.')
                continue
            job.update(status='running', started=time.monotonic())
            job['logs'].append({'level': 'info', 'stage': 'start', 'message': 'Starting isolated solver'})
            receiver, sender = mp.get_context('spawn').Pipe(duplex=False)
            process = mp.get_context('spawn').Process(target=self.target,
                args=(job['payload'], sender, self.address_limit), daemon=True)
            self.active, self.process = job['id'], process
            try:
                process.start()
                sender.close()
                while job['status'] == 'running':
                    message = None
                    job['peak_rss_mb'] = max(job['peak_rss_mb'], memory_mb(process.pid, peak=True))
                    if job['peak_rss_mb'] > self.memory_limit:
                        self.finish(job, 'failed', 'MEMORY_LIMIT', 'Solve exceeded its memory limit; web worker remains available.')
                        break
                    if time.monotonic() - job['started'] > self.wall_limit:
                        self.finish(job, 'failed', 'WALL_TIME_LIMIT', 'Solve exceeded its wall-clock limit (not proof of infeasibility).')
                        break
                    if receiver.poll():
                        try:
                            message = receiver.recv()
                        except (EOFError, OSError):
                            message = None
                        if message and message['kind'] == 'result':
                            job['result'] = message['result']
                            job['peak_rss_mb'] = max(job['peak_rss_mb'], message['peak_rss_mb'])
                            self.finish(job, 'completed')
                        elif message and message['kind'] == 'error':
                            self.finish(job, 'failed', message['code'], message['message'])
                        elif message:
                            job['logs'] = (job['logs'] + [{'level': 'info', 'stage': 'solve', 'message': message['message']}])[-100:]
                    if job['status'] == 'running' and not process.is_alive():
                        # Drain a final result before treating exit as failure.
                        if not receiver.poll():
                            self.finish(job, 'failed', 'CHILD_EXIT', f'Solver process exited unexpectedly (exit {process.exitcode}; possible out-of-memory).')
                        elif message is None:
                            self.finish(job, 'failed', 'CHILD_EXIT', f'Solver process exited unexpectedly (exit {process.exitcode}; possible out-of-memory).')
                    await asyncio.sleep(0.05)
            except Exception as error:
                if job['status'] not in TERMINAL:
                    self.finish(job, 'failed', 'CHILD_EXIT' if isinstance(error, (EOFError, BrokenPipeError)) else 'PROCESS_ERROR',
                                f'Solver process communication failed ({type(error).__name__}; possible out-of-memory).')
            finally:
                if process.pid:
                    if process.is_alive():
                        process.kill()
                    await asyncio.to_thread(process.join, 5)
                    process.close()
                receiver.close()
                sender.close()
                self.active, self.process = None, None

    async def close(self):
        self.closing = True
        for job in list(self.jobs.values()):
            if job['status'] not in TERMINAL:
                self.cancel(job['id'])
        if self.task:
            await self.task
