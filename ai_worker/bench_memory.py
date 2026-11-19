"""Private CSV ZIP -> backend builder -> fresh solver process -> backend validator.

Only aggregate measurements are printed. Input and schedules are never written.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def node(source, data):
    run = subprocess.run(['node', '-e', source], input=json.dumps(data), cwd=ROOT,
                         capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(run.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', nargs='?')
    parser.add_argument('--child', action='store_true')
    parser.add_argument('--without-homeroom', action='store_true')
    parser.add_argument('--http', action='store_true', help='Run through a local Uvicorn job API')
    parser.add_argument('--seconds', type=float, default=60)
    parser.add_argument('--seed', type=int, default=1)
    args = parser.parse_args()
    if args.child:
        from memory_usage import memory_mb
        from solver import solve_timetable
        baseline = memory_mb()
        payload = json.load(sys.stdin)
        start = time.perf_counter()
        result = solve_timetable(payload)
        print(json.dumps({'result': result, 'wall': time.perf_counter() - start,
                          'baselineMB': baseline, 'peakRSSMB': memory_mb(peak=True)}))
        return
    names = {'teacher', 'room', 'student_group', 'subject', 'teach', 'register', 'timeslot'}
    with zipfile.ZipFile(args.archive) as archive:
        files = {Path(n).stem: archive.read(n).decode('utf-8-sig') for n in archive.namelist()
                 if Path(n).suffix.lower() == '.csv' and Path(n).stem in names}
    assert set(files) == names, 'Seven CSV tables are required'
    converted = node('''
const fs = require('fs');
const {parseCsv} = require('./backend/src/lib/csv');
const {buildSolverPayload, withHomeroom} = require('./backend/src/lib/dataset');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
let tables = Object.fromEntries(Object.entries(input.files).map(([k,v]) => [k,parseCsv(v)]));
if (input.homeroom) {
  if (!withHomeroom) throw new Error('This checkout has no withHomeroom builder');
  tables = withHomeroom(tables);
}
const payload = buildSolverPayload(tables, [], input.seconds, {roomTypeMatch:true});
payload.seed = input.seed;
process.stdout.write(JSON.stringify({tables,payload}));
''', {'files': files, 'homeroom': not args.without_homeroom, 'seconds': args.seconds, 'seed': args.seed})
    env = {**os.environ, 'AI_SOLVER_WORKERS': '1', 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1'}
    if args.http:
        import requests
        import socket
        from memory_usage import memory_mb
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1',
                                   '--port', str(port), '--workers', '1'], cwd=ROOT / 'ai_worker', env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f'http://127.0.0.1:{port}'
        try:
            for _ in range(100):
                try:
                    health = requests.get(url+'/', timeout=1)
                    health.raise_for_status()
                    break
                except requests.RequestException:
                    time.sleep(.1)
            else:
                raise RuntimeError('Local worker failed to start')
            baseline = health.json()['server_rss_mb']
            started = time.perf_counter()
            response = requests.post(url+'/jobs', json=converted['payload'], headers={
                'Idempotency-Key': 'benchmark', 'X-Request-ID': 'benchmark'}, timeout=5)
            response.raise_for_status()
            job = response.json()
            while job['status'] not in ('completed', 'failed', 'cancelled'):
                assert time.perf_counter() - started < 180, 'Job did not terminate'
                time.sleep(.1)
                job = requests.get(url+'/jobs/benchmark', timeout=5).json()
            if job['status'] != 'completed':
                raise RuntimeError(job.get('error', job['status']))
            parent_peak = requests.get(url+'/', timeout=5).json()['server_peak_rss_mb']
            measured = {'result': job['result'], 'wall': time.perf_counter()-started,
                        'baselineMB': baseline, 'peakRSSMB': job['peak_rss_mb'],
                        'serverPeakMB': parent_peak, 'combinedPeakUpperBoundMB': parent_peak+job['peak_rss_mb'],
                        'runtime_version': health.json()['runtime_version']}
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    else:
        run = subprocess.run([sys.executable, __file__, '--child'], input=json.dumps(converted['payload']),
                             capture_output=True, text=True, encoding='utf-8', env=env, check=True)
        measured = json.loads(run.stdout.strip().splitlines()[-1])
    result = measured.pop('result')
    summary = {**measured, 'status': result['status'], 'stats': result.get('stats'),
               'counts': {k: len(v) for k,v in converted['payload'].items() if isinstance(v, list)},
               'profile': result.get('stats', {}).get('profile'), 'seed': args.seed}
    if result['status'] == 'SUCCESS':
        report = node('''
const fs = require('fs');
const {buildScheduleView} = require('./backend/src/lib/dataset');
const {validateSchedule} = require('./backend/src/lib/validateSchedule');
const {tables,payload,result} = JSON.parse(fs.readFileSync(0, 'utf8'));
const schedule = buildScheduleView('bench',result.solver_status,'bench',result.schedule,tables);
schedule.constraints = payload.constraints;
process.stdout.write(JSON.stringify(validateSchedule(schedule,tables,[])));
''', {**converted, 'result': result})
        summary['validation'] = [{'rule': r['ruleId'], 'status': r['status'],
                                  'violations': len(r['violations'])} for r in report['results']]
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
