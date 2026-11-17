import asyncio
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
import main
from runtime_config import search_workers
from test_solver import fixture


class RuntimeTests(unittest.TestCase):
    def request(self):
        return main.ScheduleRequest(**fixture())

    def test_only_one_solve_and_health_remains_available(self):
        entered, release = Event(), Event()
        def held_solve(_):
            entered.set()
            if not release.wait(5):
                raise RuntimeError('Test release timed out')
            return {'status': 'SUCCESS', 'schedule': []}
        with patch.object(main, 'solve_timetable', side_effect=held_solve):
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(main.solve, self.request())
                try:
                    self.assertTrue(entered.wait(3))
                    self.assertTrue(asyncio.run(main.health_check())['busy'])
                    with self.assertRaises(HTTPException) as raised:
                        main.solve(self.request())
                    self.assertEqual(raised.exception.status_code, 503)
                    self.assertEqual(raised.exception.headers['Retry-After'], '10')
                    self.assertEqual(main.solve_timetable.call_count, 1)
                finally:
                    release.set()
                self.assertEqual(future.result(timeout=3)['status'], 'SUCCESS')
        self.assertFalse(asyncio.run(main.health_check())['busy'])

    def test_failure_releases_slot_for_next_job(self):
        with patch.object(main, 'solve_timetable', side_effect=RuntimeError('private payload')):
            with self.assertRaises(HTTPException) as raised:
                main.solve(self.request())
            self.assertEqual(raised.exception.status_code, 500)
            self.assertNotIn('private payload', raised.exception.detail)
        with patch.object(main, 'solve_timetable', return_value={'status': 'UNKNOWN'}):
            self.assertEqual(main.solve(self.request())['status'], 'UNKNOWN')

    def test_server_controls_worker_limit(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(search_workers(), 1)
        for raw in ('0', '9', 'bad'):
            with patch.dict(os.environ, {'AI_SOLVER_WORKERS': raw}):
                with self.assertRaises(ValueError):
                    search_workers()
        with patch.dict(os.environ, {'AI_SOLVER_WORKERS': '2'}):
            self.assertEqual(search_workers(), 2)

    def test_unbounded_search_time_is_rejected(self):
        for value in (0, -1, 121, float('inf'), float('nan')):
            with self.assertRaises(ValidationError):
                main.ScheduleRequest(**{**fixture(), 'time_limit_seconds': value})


if __name__ == '__main__':
    unittest.main()
