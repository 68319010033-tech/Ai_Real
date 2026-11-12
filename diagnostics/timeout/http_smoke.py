"""Exercise the real local FastAPI /solve endpoint using synthetic inputs."""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'ai_worker'))
from test_solver import fixture, verify_schedule

with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
base = f'http://127.0.0.1:{port}'
with (Path(__file__).parent / 'http-server.txt').open('w', encoding='utf-8') as log:
    process = subprocess.Popen(
        [sys.executable, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', str(port)],
        cwd=ROOT / 'ai_worker', stdout=log, stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
    )
    try:
        deadline = time.monotonic() + 20
        while True:
            try:
                with urlopen(base, timeout=1) as response:
                    assert response.status == 200
                break
            except OSError:
                if process.poll() is not None or time.monotonic() > deadline:
                    raise
                time.sleep(0.1)
        for rooms in (1, 0):
            data = fixture(rooms=rooms)
            request = Request(base + '/solve', data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
            with urlopen(request, timeout=10) as response:
                result = json.load(response)
            if rooms:
                verify_schedule(data, result)
            else:
                assert result['status'] == 'INFEASIBLE', result
            print(json.dumps({'synthetic': True, 'endpoint': '/solve', 'rooms': rooms, 'status': result['status'], 'rows': len(result['schedule']), 'check': 'PASS'}))
    finally:
        process.terminate()
        process.wait(timeout=10)
