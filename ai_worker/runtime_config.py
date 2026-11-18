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


def configure_solver(parameters):
    """Measured profiles; benchmark overrides are server-owned, never payload fields."""
    import json
    profile = os.getenv('AI_SOLVER_PROFILE', 'low_ram')
    profiles = {
        'low_ram': {},
        'fast': {'cp_model_presolve': False, 'symmetry_level': 0,
                 'cp_model_probing_level': 0, 'linearization_level': 0},
    }
    if profile not in profiles:
        raise ValueError('AI_SOLVER_PROFILE must be low_ram or fast')
    settings = {**profiles[profile], **json.loads(os.getenv('AI_SOLVER_BENCH_PARAMS', '{}'))}
    allowed = {'cp_model_presolve', 'max_presolve_iterations', 'symmetry_level',
               'cp_model_probing_level', 'linearization_level'}
    if set(settings) - allowed:
        raise ValueError('Unsupported solver benchmark parameter')
    for key, value in settings.items():
        setattr(parameters, key, value)
    parameters.max_memory_in_mb = int(os.getenv('AI_SOLVER_MEMORY_MB', '256'))
    return profile
