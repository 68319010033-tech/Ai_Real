import unittest
from unittest.mock import Mock, patch
from search_budget import ImprovementWindow, remaining_search_seconds
from jobs import JobManager


class SearchBudgetTests(unittest.TestCase):
    def test_build_time_consumes_the_requested_budget(self):
        self.assertEqual(remaining_search_seconds(60, 17), 43)
        self.assertEqual(remaining_search_seconds(120, 17), 83)
        self.assertEqual(remaining_search_seconds(5, 6), 0)

    def test_improvement_timer_stops_without_another_solution(self):
        solver = Mock()
        with patch('search_budget.Timer') as timer, patch.object(ImprovementWindow, 'WallTime', return_value=2.5):
            callback = ImprovementWindow(solver)
            callback.on_solution_callback()
            callback.on_solution_callback()
            timer.assert_called_once_with(5.0, solver.StopSearch)
            self.assertEqual(callback.first_solution_seconds, 2.5)
            timer.call_args.args[1]()
            solver.StopSearch.assert_called_once()
            callback.close()
            timer.return_value.cancel.assert_called_once()
            timer.return_value.join.assert_called_once()

    def test_old_deployment_override_cannot_exceed_child_ceiling(self):
        with patch.dict('os.environ', {'AI_JOB_WALL_SECONDS': '150'}):
            self.assertEqual(JobManager().wall_limit, 110)
        with patch.dict('os.environ', {'AI_JOB_WALL_SECONDS': '30'}):
            self.assertEqual(JobManager().wall_limit, 30)
