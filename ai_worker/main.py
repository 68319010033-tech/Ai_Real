import asyncio
from contextlib import asynccontextmanager
import os
import re
from uuid import uuid4
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import List, Dict, Any
from jobs import JobManager, JobError
from runtime_config import search_workers
from memory_usage import memory_mb

manager = JobManager()

@asynccontextmanager
async def lifespan(app):
    async def cleanup_loop():
        while True:
            await asyncio.sleep(30)
            manager.cleanup()
    cleanup = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        cleanup.cancel()
        await manager.close()

app = FastAPI(title='Timetable Optimization Worker', lifespan=lifespan)

class ScheduleRequest(BaseModel):
    model_config = ConfigDict(extra='allow')
    teachers: List[Dict[str, Any]] = Field(max_length=100)
    rooms: List[Dict[str, Any]] = Field(max_length=100)
    student_groups: List[Dict[str, Any]] = Field(max_length=100)
    subjects: List[Dict[str, Any]] = Field(max_length=500)
    registers: List[Dict[str, Any]] = Field(max_length=1000)
    timeslots: List[Dict[str, Any]] = Field(max_length=200)
    teaches: List[Dict[str, Any]] = Field(default_factory=list, max_length=5000)
    special_rules: List[str] = Field(default_factory=list, max_length=30)
    room_locks: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)
    time_limit_seconds: float = Field(default=60, gt=0, le=120, allow_inf_nan=False)
    seed: int = Field(default=1, ge=0, le=2147483647)

    @model_validator(mode='after')
    def candidate_limit(self):
        unsupported = set(self.special_rules) - {'C14','C15','C16','C17','C18','C19'}
        if unsupported:
            raise ValueError('Unsupported special rules: ' + ', '.join(sorted(unsupported)))
        for table, field in ((self.teachers,'teacher_id'), (self.rooms,'room_id'),
                             (self.subjects,'subject_id'), (self.student_groups,'group_id'),
                             (self.timeslots,'timeslot_id')):
            ids = [str(row.get(field) or '') for row in table]
            if any(not value for value in ids) or len(ids) != len(set(ids)):
                raise ValueError(field + ' must be nonempty and unique')
        subject_ids = {str(row['subject_id']) for row in self.subjects}
        teacher_ids = {str(row['teacher_id']) for row in self.teachers}
        group_ids = {str(row['group_id']) for row in self.student_groups}
        registrations = set()
        for row in self.registers:
            key = (str(row.get('group_id')), str(row.get('subject_id')))
            if key in registrations or key[0] not in group_ids or key[1] not in subject_ids:
                raise ValueError('Registrations must be unique and reference existing groups and subjects')
            registrations.add(key)
        for row in self.teaches:
            if str(row.get('subject_id')) not in subject_ids or str(row.get('teacher_id')) not in teacher_ids:
                raise ValueError('Teach rows must reference existing teachers and subjects')
        if len(self.registers) * len(self.teachers) * len(self.timeslots) > 2_000_000:
            raise ValueError('Dataset too large: registration x teacher x slot count exceeds 2,000,000')
        return self

# Check actual streamed bytes, not only Content-Length.
class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            size += len(message.get('body', b''))
            if size > int(os.getenv('AI_MAX_PAYLOAD_BYTES', '2097152')):
                return await JSONResponse({'detail': 'Payload exceeds worker byte limit'}, status_code=413)(scope, receive, send)
            messages.append(message)
            if not message.get('more_body', False):
                break
        async def replay():
            return messages.pop(0) if messages else await receive()
        await self.app(scope, replay, send)

app.add_middleware(BodyLimit)

@app.exception_handler(JobError)
async def job_error(request, error):
    return JSONResponse({'detail': error.message, 'boot_id': manager.boot_id}, status_code=error.status,
                        headers={'Retry-After': '3'} if error.status == 429 else {})

@app.get('/')
@app.get('/health')
async def health_check():
    return {'status': 'AI Worker is running', 'busy': manager.active is not None,
            'search_workers': search_workers(), 'runtime_version': 'async-jobs-v4', 'boot_id': manager.boot_id,
            'server_rss_mb': memory_mb(), 'server_peak_rss_mb': memory_mb(peak=True)}

@app.head('/')
@app.get('/favicon.ico', status_code=204)
async def empty_response():
    return Response(status_code=204)

def safe_key(value):
    if not value or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', value):
        raise HTTPException(400, 'Idempotency-Key must contain 1-120 letters, numbers, underscores or hyphens')
    return value

@app.post('/jobs', status_code=202)
async def create_job(payload: ScheduleRequest, idempotency_key: str = Header(...), x_request_id: str = Header(default='')):
    return manager.submit(payload.model_dump(), safe_key(idempotency_key), safe_key(x_request_id or idempotency_key))

@app.get('/jobs/{job_id}')
async def get_job(job_id: str):
    return manager.view(job_id)

@app.delete('/jobs/{job_id}')
async def delete_job(job_id: str):
    return manager.cancel(safe_key(job_id))

@app.post('/cancel')
async def cancel(payload: dict = None):
    key = (payload or {}).get('job_id') or manager.active
    return manager.cancel(key) if key else {'status': 'idle'}

@app.post('/solve')
async def solve(payload: ScheduleRequest, x_request_id: str = Header(default='')):
    key = uuid4().hex
    manager.submit(payload.model_dump(), key, safe_key(x_request_id or key))
    while manager.jobs[key]['status'] not in {'completed', 'failed', 'cancelled'}:
        await asyncio.sleep(0.1)
    job = manager.view(key)
    if 'result' in job:
        return job['result']
    return {'status': 'FAILED' if job['status'] == 'failed' else 'CANCELLED',
            'solver_status': 'FAILED' if job['status'] == 'failed' else 'CANCELLED',
            'reason': job.get('error'), 'error_code': job.get('error_code'), 'schedule': [],
            'logs': job['logs'], 'stats': {'wallTimeSec': job['elapsed_seconds'], 'peakRSSMB': job['peak_rss_mb']}}
