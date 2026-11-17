"""Server-owned limits; clients cannot request more search workers."""
import os


def search_workers():
    raw = os.getenv("AI_SOLVER_WORKERS", "1")
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError("AI_SOLVER_WORKERS must be an integer from 1 to 8") from error
    if not 1 <= value <= 8:
        raise ValueError("AI_SOLVER_WORKERS must be an integer from 1 to 8")
    return value
