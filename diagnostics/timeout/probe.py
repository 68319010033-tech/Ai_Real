"""Synthetic diagnostic only; no user timetable data or application changes."""
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

def run_case(size):
    import solver_snapshot as target
    start = time.perf_counter()
    original = target.cp_model.CpSolver.Solve
    def measured(self, model, *args, **kwargs):
        print(json.dumps({'stage': 'search_start', 'build_seconds': round(time.perf_counter()-start, 3), 'variables': len(model.Proto().variables), 'constraints': len(model.Proto().constraints)}), flush=True)
        return original(self, model, *args, **kwargs)
    target.cp_model.CpSolver.Solve = measured
    slots = 1 if size == 1 else 55
    rooms = 1 if size == 1 else 22
    data = {
        'teachers': [{'teacher_id': f'T{i}'} for i in range(size)],
        'rooms': [{'room_id': f'R{i}'} for i in range(rooms)],
        'student_groups': [{'group_id': f'G{i}'} for i in range(size)],
        'subjects': [{'subject_id': f'S{i}', 'theory': 1, 'practice': 0} for i in range(size)],
        'teaches': [{'teacher_id': f'T{i}', 'subject_id': f'S{i}'} for i in range(size)],
        'registers': [{'group_id': f'G{i}', 'subject_id': f'S{i}'} for i in range(size)],
        'timeslots': [{'timeslot_id': f'L{i}', 'day': i//11+1, 'period': (i%11+1 if i%11<4 else i%11+2)} for i in range(slots)],
        'time_limit_seconds': 5,
    }
    print(json.dumps({'synthetic': True, 'registrations': size, 'room_variables_expected': size*slots*rooms, 'seed': 'production default; seed is not set by solver'}), flush=True)
    result = target.solve_timetable(data)
    print(json.dumps({'stage': 'result', 'status': result['status'], 'expected_rows': size, 'actual_rows': len(result['schedule']), 'elapsed_seconds': round(time.perf_counter()-start, 3)}), flush=True)

if len(sys.argv) > 1:
    run_case(int(sys.argv[1]))
else:
    lines = ['GitHub integration solver blob: 9cd14b14806dea4ff1dccd968e6f2f62af4d0f64', 'All cases use synthetic data, not user data.']
    for size in (1, 10, 40):
        try:
            result = subprocess.run([sys.executable, '-u', __file__, str(size)], capture_output=True, text=True, timeout=55)
            lines.extend([result.stdout, result.stderr, f'exit={result.returncode}'])
        except subprocess.TimeoutExpired as error:
            output = error.stdout or b''
            lines.extend([output.decode() if isinstance(output, bytes) else output, 'Stopped after 55 seconds; subprocess terminated.'])
        print('\n'.join(lines), flush=True)
        (HERE/'results.txt').write_text('\n'.join(lines), encoding='utf-8')
