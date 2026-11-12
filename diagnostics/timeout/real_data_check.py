"""Read a supplied CSV ZIP, use the backend payload builder, and audit locally."""
import csv
import hashlib
import io
import json
import subprocess
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'ai_worker'))
from solver import solve_timetable
from test_solver import verify_schedule

archive = Path(sys.argv[1])
output = Path(__file__).parent / 'real-data-local'
output.mkdir(exist_ok=True)
(output / '.gitignore').write_text('*\n', encoding='utf-8')
names = ['teacher', 'room', 'student_group', 'subject', 'teach', 'register', 'timeslot']
with zipfile.ZipFile(archive) as z:
    files = {Path(name).stem: z.read(name).decode('utf-8-sig') for name in z.namelist()
             if Path(name).suffix.lower() == '.csv' and Path(name).stem in names}
assert set(files) == set(names), 'ZIP must contain all seven required CSV tables'
bridge = r"""
const fs = require('fs');
const { parseCsv } = require('./backend/src/lib/csv');
const { buildSolverPayload } = require('./backend/src/lib/dataset');
const files = JSON.parse(fs.readFileSync(0, 'utf8'));
const tables = Object.fromEntries(Object.entries(files).map(([k,v]) => [k,parseCsv(v)]));
const payload = buildSolverPayload(tables, [], 30, {maxPeriodsPerDay: 10, roomTypeMatch: false});
process.stdout.write(JSON.stringify({tables,payload}));
"""
converted = subprocess.run(['node', '-e', bridge], input=json.dumps(files), cwd=ROOT,
                           capture_output=True, text=True, encoding='utf-8', check=True)
converted = json.loads(converted.stdout)
tables, payload = converted['tables'], converted['payload']
summary = {'archive': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
           'counts': {k: len(v) for k,v in tables.items()},
           'mode': 'Current backend defaults; approved pairs, no extra rules, maxPeriodsPerDay=10, roomTypeMatch=false',
           'joint_policy': {k: payload['constraints'][k] for k in ('jointMode', 'jointPairs')},
           'seed': 1, 'search_limit_seconds': 30}
print(json.dumps(summary), flush=True)
started = time.perf_counter()
result = solve_timetable(payload)
summary.update(status=result['status'], elapsed_seconds=round(time.perf_counter()-started, 3),
               rows=len(result.get('schedule', [])), stats=result.get('stats'), reason=result.get('reason'))
(output / 'worker-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
if result['status'] == 'SUCCESS':
    verify_schedule(payload, result)
    slots = {s['timeslot_id']: s for s in payload['timeslots']}
    days = Counter((r['group_id'], slots[r['timeslot_id']]['day']) for r in result['schedule'])
    assert all(n <= 10 for n in days.values()), 'Daily limit exceeded'
    summary['independent_current_model_checks'] = 'PASS: required hours, valid IDs, teacher eligibility, group/teacher/room collisions, lunch, daily limit'
    validate = r"""
const fs = require('fs');
const { buildScheduleView } = require('./backend/src/lib/dataset');
const { validateSchedule } = require('./backend/src/lib/validateSchedule');
const {tables,result,policy} = JSON.parse(fs.readFileSync(0, 'utf8'));
const schedule = buildScheduleView('local-diagnostic', result.solver_status, 'local-diagnostic', result.schedule, tables);
schedule.constraints = policy;
process.stdout.write(JSON.stringify(validateSchedule(schedule,tables,[])));
"""
    checked = subprocess.run(['node', '-e', validate], input=json.dumps({'tables': tables, 'result': result, 'policy': payload['constraints']}),
                             cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
    report = json.loads(checked.stdout)
    (output / 'backend-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    summary['backend_rule_results'] = [{'rule': r['ruleId'], 'status': r['status'], 'violations': len(r['violations'])} for r in report['results']]
    with (output / 'candidate-not-approved.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['group_id','timeslot_id','subject_id','teacher_id','room_id'])
        writer.writeheader()
        writer.writerows(result['schedule'])
(output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summary), flush=True)
