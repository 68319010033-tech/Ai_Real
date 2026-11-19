import asyncio
import os
import time
import unittest
from unittest.mock import patch
from pydantic import ValidationError
import main
from jobs import JobManager, JobError
from runtime_config import search_workers, solver_profile
from test_solver import fixture


def held_child(payload, sender, limit):
    time.sleep(30)


def exited_child(payload, sender, limit):
    os._exit(17)


class JobTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.manager = JobManager()

    async def asyncTearDown(self):
        await self.manager.close()

    async def terminal(self, key, seconds=15):
        end = time.monotonic()+seconds
        while self.manager.view(key)['status'] not in {'completed','failed','cancelled'}:
            self.assertLess(time.monotonic(),end,'job failed to terminate')
            await asyncio.sleep(.05)
        return self.manager.view(key)

    async def started(self):
        for _ in range(100):
            if self.manager.process and self.manager.process.pid:
                return
            await asyncio.sleep(.02)
        self.fail('child did not start')

    async def test_actual_spawn_result_and_duplicate(self):
        first=self.manager.submit(fixture(),'same','request')
        duplicate=self.manager.submit(fixture(),'same','request')
        self.assertEqual(first['id'],duplicate['id'])
        self.assertEqual(len(self.manager.jobs),1)
        done=await self.terminal('same')
        self.assertEqual(done['result']['status'],'SUCCESS')
        self.assertGreater(done['peak_rss_mb'],0)
        self.assertEqual(self.manager.submit(fixture(),'same','request')['status'],'completed')
        with self.assertRaises(JobError) as error:
            self.manager.submit(fixture(slots=2),'same','request')
        self.assertEqual(error.exception.status,409)

    async def test_kill_child_and_server_survives(self):
        self.manager.target=held_child
        self.manager.submit(fixture(),'kill','request')
        await self.started()
        self.manager.process.kill()
        done=await self.terminal('kill')
        self.assertEqual(done['status'],'failed')
        self.assertEqual(done['error_code'],'CHILD_EXIT')
        self.assertIn('out-of-memory',done['error'])
        with patch.object(main,'manager',self.manager):
            self.assertEqual((await main.health_check())['runtime_version'],'async-jobs-v5')

    async def test_unexpected_exit_has_clear_message(self):
        self.manager.target=exited_child
        self.manager.submit(fixture(),'exit','request')
        done = await self.terminal('exit')
        self.assertEqual(done['error_code'],'CHILD_EXIT',done)

    async def test_queue_cancel_and_shutdown(self):
        self.manager.target=held_child
        self.manager.queue_limit=1
        self.manager.submit(fixture(),'one','request')
        await self.started()
        self.assertEqual(self.manager.submit(fixture(),'two','request')['queue_position'],1)
        with self.assertRaises(JobError) as error:
            self.manager.submit(fixture(),'three','request')
        self.assertEqual(error.exception.status,429)
        self.assertEqual(self.manager.cancel('two')['status'],'cancelled')
        await self.manager.close()
        self.assertEqual(self.manager.view('one')['status'],'cancelled')
        self.assertIsNone(self.manager.process)

    async def test_wall_limit_and_memory_limit(self):
        self.manager.target=held_child
        self.manager.wall_limit=.1
        self.manager.submit(fixture(),'wall','request')
        self.assertEqual((await self.terminal('wall'))['error_code'],'WALL_TIME_LIMIT')
        self.manager.wall_limit=10
        self.manager.memory_limit=1
        self.manager.submit(fixture(),'memory','request')
        self.assertEqual((await self.terminal('memory'))['error_code'],'MEMORY_LIMIT')

    async def test_ttl_and_cap_keep_idempotency_until_expiry(self):
        self.manager.cap=1
        self.manager.submit(fixture(),'one','request')
        self.manager.cancel('one')
        with self.assertRaises(JobError):
            self.manager.submit(fixture(),'two','request')
        self.manager.jobs['one']['finished']-=self.manager.ttl+1
        self.assertEqual(self.manager.submit(fixture(),'two','request')['status'],'queued')
        with self.assertRaises(JobError):
            self.manager.view('one')

    async def test_queue_wait_limit(self):
        self.manager.queue_wait=-1
        self.manager.submit(fixture(),'wait','request')
        self.assertEqual((await self.terminal('wait'))['error_code'],'QUEUE_TIMEOUT')

    async def test_shutdown_with_expired_terminal_record(self):
        self.manager.submit(fixture(),'live','request')
        self.manager.submit(fixture(),'expired','request')
        self.manager.cancel('expired')
        self.manager.jobs['expired']['finished'] -= self.manager.ttl + 1
        await self.manager.close()
        self.assertEqual(self.manager.view('live')['status'],'cancelled')

    async def test_boot_changes_and_unknown_job_is_explicit(self):
        other=JobManager()
        self.assertNotEqual(other.boot_id,self.manager.boot_id)
        with self.assertRaises(JobError) as error:
            other.view('lost')
        self.assertIn('restarted',error.exception.message)
        await other.close()


class RuntimeTests(unittest.TestCase):
    def test_profile_defaults_to_fast_and_allows_explicit_fallback(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(solver_profile(), 'fast')
        with patch.dict(os.environ, {'AI_SOLVER_PROFILE': 'low_ram'}):
            self.assertEqual(solver_profile(), 'low_ram')
        with patch.dict(os.environ, {'AI_SOLVER_PROFILE': 'typo'}):
            with self.assertRaises(ValueError):
                solver_profile()

    def test_server_controls_worker_limit(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(search_workers(),1)
        for raw in ('0','9','bad'):
            with patch.dict(os.environ,{'AI_SOLVER_WORKERS':raw}):
                with self.assertRaises(ValueError): search_workers()

    def test_limits(self):
        for value in (0,-1,121,float('inf'),float('nan')):
            with self.assertRaises(ValidationError):
                main.ScheduleRequest(**{**fixture(),'time_limit_seconds':value})
        with self.assertRaises(ValidationError):
            main.ScheduleRequest(**{**fixture(),'rooms':[{}]*101})

if __name__ == '__main__': unittest.main()
