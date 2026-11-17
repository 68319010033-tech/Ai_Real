# Resource-safe AI worker

This patch addresses unbounded concurrent solves and the fixed eight-worker
search configuration. Those are verified resource risks, not a proven root
cause of the intermittent production 502. Verify after deployment.

## Deploy the worker

- Deploy the commit containing `runtime_config.py` and the updated `main.py`.
- `AI_SOLVER_WORKERS` defaults to `1`. Optional values are integers 1–8; use 1
  initially on constrained compute. Do not increase it without measurements.
- Run exactly one Uvicorn process per instance. The Dockerfile enforces this
  and binds to `PORT` (8000 locally when unset).
- For a native Python service with root directory `ai_worker`, use:
  `uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1`
- A process-local lock admits one solve. Additional requests return HTTP 503
  with Retry-After: 10. Do not automatically resend a timed-out solve: the old
  request may still be computing. The lock is per process, not per cluster.
- Search input is limited to 0 < time_limit_seconds <= 120, with the existing
  solver minimum of 5 seconds. This search limit does not include model build.

The root endpoint must return `runtime_version: resource-safe-v1`,
`search_workers: 1`, and `busy: false` when idle. It remains an async endpoint
so routine health checks do not consume the synchronous solve thread pool.

## Deploy the backend

Deploy `backend/src/lib/aiErrors.js` and the changed schedule route together.
Keep AI_WORKER_URL set to `https://ai-real-ek52.onrender.com`.
The backend now reports gateway, busy/unavailable, and timeout errors separately
and retains an error log entry instead of dropping all diagnostic information.
An HTTP 400 alone no longer becomes an INFEASIBLE result.

No secret or credential changes are required. Existing frontend can display
the new messages without a frontend deployment.

## Verify

1. Check the worker root JSON for the version and worker count above.
2. Run one scheduling job with the approved CSVs and existing constraints.
3. Check for paired `solve_start` / `solve_end` messages and request IDs in logs.
   The messages contain counts, elapsed time, and status, not teacher names or
   uploaded rows. Exceptions emit `solve_error` with a reference ID.
4. If 502 recurs, inspect Render runtime/deploy events at the same time for a
   process exit, OOM, health-check failure, or server timeout. A missing end
   message alone does not prove OOM. Do not hide 502 with a fabricated schedule.

The original live URL returned intermittent 502, while subsequent requests
returned HTTP 200 UNKNOWN at the 30-second search limit. The original cause
remains unverified without those runtime logs. A successful local test is not
evidence that the production problem is resolved.

## Local evidence

20 solver regressions, 4 runtime/config/concurrency tests, and 9 backend tests
pass. Local HTTP smoke checks return SUCCESS and INFEASIBLE appropriately.
Actual CSV run returns 237 rows in 18.605 s, searchWorkers=1, seed=1.
C01–C08, C10, and C13 pass; C09/C12 still fail and C11 is unresolved. The output
is not approved as a fully compliant final timetable.

Logs are in `diagnostics/timeout/resource-safe-*.txt` and
`diagnostics/timeout/runtime-guard-tests.txt`. User output remains ignored.
