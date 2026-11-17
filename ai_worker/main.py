import logging
from threading import Lock
from time import perf_counter
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Dict, Any
from solver import solve_timetable
from runtime_config import search_workers

app = FastAPI(title="Timetable Optimization Worker")
solve_lock = Lock()
logger = logging.getLogger("uvicorn.error")
WORKERS = search_workers()

class ScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    teachers: List[Dict[str, Any]]
    rooms: List[Dict[str, Any]]
    student_groups: List[Dict[str, Any]]
    subjects: List[Dict[str, Any]]
    registers: List[Dict[str, Any]]
    timeslots: List[Dict[str, Any]]
    teaches: List[Dict[str, Any]] = Field(default_factory=list)
    special_rules: List[str] = Field(default_factory=list)
    room_locks: List[Dict[str, Any]] = Field(default_factory=list)
    time_limit_seconds: float = Field(default=60, gt=0, le=120, allow_inf_nan=False)

@app.get("/")
async def health_check():
    # Keep health checks on the event loop, outside the sync solve thread pool.
    return {"status": "AI Worker is running", "busy": solve_lock.locked(),
            "search_workers": WORKERS, "runtime_version": "resource-safe-v1"}

@app.post("/solve")
def solve(payload: ScheduleRequest):
    # Do not run multiple memory-heavy CP-SAT models in the same process.
    # A caller may retry after completion; never queue duplicate solves silently.
    if not solve_lock.acquire(blocking=False):
        raise HTTPException(status_code=503,
                            detail="AI worker is busy. Wait for the current job to finish before retrying.",
                            headers={"Retry-After": "10"})
    request_id = uuid4().hex
    started = perf_counter()
    logger.info("solve_start request_id=%s registrations=%d slots=%d rooms=%d workers=%d",
                request_id, len(payload.registers), len(payload.timeslots), len(payload.rooms), WORKERS)
    try:
        result = solve_timetable(payload.model_dump())
        logger.info("solve_end request_id=%s status=%s elapsed=%.3f",
                    request_id, result.get("status"), perf_counter() - started)
        return result
    except Exception as error:
        # Avoid logging submitted timetable contents or teacher names.
        logger.error("solve_error request_id=%s type=%s elapsed=%.3f",
                     request_id, type(error).__name__, perf_counter() - started)
        raise HTTPException(status_code=500, detail=f"AI computation failed; reference {request_id}") from error
    finally:
        solve_lock.release()
