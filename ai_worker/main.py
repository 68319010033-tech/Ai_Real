from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Dict, Any
from solver import solve_timetable

app = FastAPI(title="Timetable Optimization Worker")

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
    time_limit_seconds: float = 60

@app.get("/")
def health_check():
    return {"status": "AI Worker is running"}

@app.post("/solve")
def solve(payload: ScheduleRequest):
    return solve_timetable(payload.model_dump())
