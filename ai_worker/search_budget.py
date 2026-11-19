"""Bound improvement time without abandoning an already valid timetable."""
from threading import Timer
from ortools.sat.python import cp_model


def remaining_search_seconds(total, build_seconds):
    return max(0.0, min(100.0, total) - build_seconds)


class ImprovementWindow(cp_model.CpSolverSolutionCallback):
    def __init__(self, solver, seconds=5.0):
        super().__init__()
        self.solver = solver
        self.seconds = seconds
        self.timer = None
        self.first_solution_seconds = None

    def on_solution_callback(self):
        if self.timer is None:
            self.first_solution_seconds = round(self.WallTime(), 3)
            # A timer, rather than checking elapsed time only on new solutions,
            # also stops a search that makes no further improvements.
            self.timer = Timer(self.seconds, self.solver.StopSearch)
            self.timer.daemon = True
            self.timer.start()

    def close(self):
        if self.timer is not None:
            self.timer.cancel()
            self.timer.join()
