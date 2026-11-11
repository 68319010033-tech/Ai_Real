from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from solver import solve_timetable

app = FastAPI(title="Timetable Optimization Worker")

class ScheduleRequest(BaseModel):
    teachers: List[Dict[str, Any]]
    rooms: List[Dict[str, Any]]
    student_groups: List[Dict[str, Any]]
    subjects: List[Dict[str, Any]]
    registers: List[Dict[str, Any]]
    timeslots: List[Dict[str, Any]]

@app.get("/")
def health_check():
    return {"status": "AI Worker is running"}

@app.post("/solve")
def solve(payload: ScheduleRequest):
    data = payload.dict()
    result = solve_timetable(data)
    if result["status"] == "INFEASIBLE":
        raise HTTPException(status_code=400, detail="Cannot find feasible timetable with current constraints")
    return result