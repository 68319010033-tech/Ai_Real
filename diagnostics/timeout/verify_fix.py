"""Benchmark the actual worker using synthetic data and independent checks."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'ai_worker'))
from solver import solve_timetable
from test_solver import fixture, verify_schedule

for count in (1, 10, 40):
    data = fixture(count, slots=1 if count == 1 else 55, rooms=1 if count == 1 else 22)
    data['time_limit_seconds'] = 30
    result = solve_timetable(data)
    verify_schedule(data, result)
    print(json.dumps({'synthetic': True, 'registrations': count, 'seed': 1,
                      'status': result['status'], 'rows': len(result['schedule']),
                      'stats': result['stats'], 'independent_validation': 'PASS'}), flush=True)
