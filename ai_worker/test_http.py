import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
import requests
from test_solver import fixture

class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        cls.url=f'http://127.0.0.1:{port}'
        cls.server=subprocess.Popen([sys.executable,'-m','uvicorn','main:app','--host','127.0.0.1','--port',str(port)],
            cwd=Path(__file__).parent,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            env={**os.environ,'AI_SOLVER_WORKERS':'1'})
        for _ in range(100):
            try:
                if requests.get(cls.url+'/',timeout=1).ok: return
            except requests.RequestException: pass
            time.sleep(.1)
        cls.server.kill();cls.server.wait();raise RuntimeError('worker did not start')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try: cls.server.wait(timeout=10)
        except subprocess.TimeoutExpired: cls.server.kill();cls.server.wait()

    def test_health_and_payload_limits(self):
        self.assertEqual(requests.head(self.url+'/',timeout=5).status_code,204)
        self.assertEqual(requests.get(self.url+'/favicon.ico',timeout=5).status_code,204)
        self.assertEqual(requests.get(self.url+'/health',timeout=5).json()['runtime_version'],'async-jobs-v6')
        health = requests.get(self.url+'/health', timeout=5).json()
        self.assertIn(health['solver_profile'], ('fast', 'low_ram'))
        self.assertLessEqual(health['active_wall_limit_seconds'], 110)
        self.assertEqual(health['queued_jobs'], 0)
        response=requests.post(self.url+'/jobs',data=b'x'*2100000,headers={'Content-Type':'application/json','Idempotency-Key':'big'},timeout=5)
        self.assertEqual(response.status_code,413)
        response=requests.post(self.url+'/jobs',json={**fixture(),'rooms':[{}]*101},headers={'Idempotency-Key':'count'},timeout=5)
        self.assertEqual(response.status_code,422)

    def test_async_duplicate_and_result(self):
        headers={'Idempotency-Key':'http-duplicate','X-Request-ID':'test-request'}
        first=requests.post(self.url+'/jobs',json=fixture(),headers=headers,timeout=5)
        self.assertEqual(first.status_code,202)
        duplicate=requests.post(self.url+'/jobs',json=fixture(),headers=headers,timeout=5)
        self.assertEqual(first.json()['id'],duplicate.json()['id'])
        for _ in range(150):
            job=requests.get(self.url+'/jobs/http-duplicate',timeout=5).json()
            if job['status']=='completed':break
            time.sleep(.1)
        self.assertEqual(job['result']['status'],'SUCCESS')
        self.assertIn('stats',job['result'])
        self.assertEqual(job['request_id'],'test-request')

    def test_cancellation_tombstone_prevents_late_post(self):
        response=requests.delete(self.url+'/jobs/cancel-before-post',timeout=5)
        self.assertEqual(response.json()['status'],'cancelled')
        response=requests.post(self.url+'/jobs',json=fixture(),headers={'Idempotency-Key':'cancel-before-post'},timeout=5)
        self.assertEqual(response.status_code,202)
        self.assertEqual(response.json()['status'],'cancelled')

    def test_legacy_solve_shape(self):
        response=requests.post(self.url+'/solve',json=fixture(),timeout=15)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['status'],'SUCCESS')
        self.assertIn('stats',response.json())

    def test_worker_restart_loses_queued_job_and_changes_boot(self):
        # A dedicated worker with an impossibly short hard limit is not needed:
        # restart immediately after accepting work, then verify the public contract.
        import signal
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        url=f'http://127.0.0.1:{port}'
        command=[sys.executable,'-m','uvicorn','fault_worker:app','--host','127.0.0.1','--port',str(port)]
        def start():
            process=subprocess.Popen(command,cwd=Path(__file__).parent,
                                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            for _ in range(100):
                try:
                    health=requests.get(url+'/',timeout=1)
                    if health.ok:return process,health.json()
                except requests.RequestException:pass
                time.sleep(.1)
            process.kill();process.wait();self.fail('restart worker failed to start')
        process,health=start()
        child_pid=None
        try:
            response=requests.post(url+'/jobs',json=fixture(),headers={'Idempotency-Key':'lost'},timeout=5)
            self.assertEqual(response.status_code,202)
            for _ in range(100):
                child_pid=requests.get(url+'/test-child-pid',timeout=5).json()['pid']
                if child_pid:break
                time.sleep(.05)
            self.assertIsNotNone(child_pid)
            self.assertEqual(requests.get(url+'/jobs/lost',timeout=5).json()['status'],'running')
            # Kill both owned processes, emulating instance loss without leaving orphans.
            os.kill(child_pid,signal.SIGTERM)
            child_pid=None
            process.terminate();process.wait(timeout=10)
            process,new_health=start()
            self.assertNotEqual(health['boot_id'],new_health['boot_id'])
            missing=requests.get(url+'/jobs/lost',timeout=5)
            self.assertEqual(missing.status_code,404)
            self.assertIn('restarted',missing.json()['detail'])
        finally:
            if child_pid:
                try:os.kill(child_pid,signal.SIGTERM)
                except ProcessLookupError:pass
            process.terminate();process.wait(timeout=10)

if __name__ == '__main__':unittest.main()
