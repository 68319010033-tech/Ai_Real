# Async timetable worker deployment

Runtime version: `async-jobs-v4`. This branch is locally tested; production deployment,
Render memory/CPU limits, and absence of production 502/503/restarts are **not verified**.
The owner chose to deploy the AI service personally; their friend deploys the backend
and frontend. No service settings were changed by this task.

## Coordinated rollout

1. Deploy this branch's `ai_worker` first. Use its Dockerfile, or native Python:
   `uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 --timeout-graceful-shutdown 5`.
   Install `requirements.txt`. Keep exactly one web process and one instance; jobs live
   in that process, not a shared cluster. Set the native-service thread environment
   variables shown below before Python starts.
2. Check `GET /`: `runtime_version=async-jobs-v4`, `search_workers=1`, a nonempty
   `boot_id`. `HEAD /` and favicon return 204; `GET /health` remains cheap during solves.
   Existing callers of `/solve` still receive the solver response including `stats`.
3. Have the friend deploy the backend and frontend from the same branch. Keep
   `AI_WORKER_URL=https://ai-real-ek52.onrender.com`. Backend calls `/jobs`, then polls
   every 2.5 s using 10 s requests and bounded exponential retries. The old backend
   endpoint `/generate` is now an async alias of `/solve-jobs` (202 + jobId); any external
   caller of that endpoint must poll. Worker `/solve` remains synchronous for rollout
   compatibility and still has the inherent long-HTTP-request proxy risk.
4. Backend uses the existing Firebase configuration to persist `aiJobs/{jobId}`.
   Use one backend process/replica for per-user admission; distributed leases are not
   implemented. In-memory fallback works without Firebase but **cannot survive process
   loss**. With Firebase, startup recovers running jobs before admitting new jobs.
   Preserve backend-only access to these records; they include the submitted dataset.
   An optional RTDB `.indexOn: ["createdAt"]` under `aiJobs` speeds bounded recovery.
   No credential changes or credential disclosure is needed.
5. Run the real dataset with 60 s search limit, seed 1, one solver thread. Confirm
   C01-C13 in the backend validator. Check queued, cancel, and second-job 409 behavior.
6. Inspect Render runtime/deploy events and structured `job_end` logs (request ID,
   elapsed seconds, peak RSS, terminal status). Confirm no stacked busy 503s, no
   unexplained restart during a solve, and elapsed time below your chosen limit.
   Until performed on Render, all three are **not verified**. Do not treat a local
   pass as proof of the old intermittent 502 cause.

## Worker API

- `POST /jobs`: JSON solver payload, `Idempotency-Key: <backend-job-id>` required;
  `X-Request-ID` propagates to job logs. Returns 202 with `id`, `boot_id`, `status`,
  `queue_position`, `elapsed_seconds`, and bounded `logs`. The same key and payload
  returns the existing job; changed payload with the same key returns 409.
- `GET /jobs/{id}`: above fields plus `result` on completion, or `error_code` and
  `error` on failure. Solver outcomes SUCCESS, INFEASIBLE, UNKNOWN, MODEL_INVALID
  stay inside `result`; infrastructure failures never become INFEASIBLE.
- `DELETE /jobs/{id}`: idempotent cancellation; kills an active child, or records a
  cancellation tombstone so a late/retried POST cannot start cancelled work.
- `POST /cancel`: `{ "job_id": "..." }`, or cancel the current active job if omitted.
- `POST /solve`: same isolated queue/core; returns legacy result shape. It cannot
  eliminate a proxy's synchronous-request timeout; new clients must use `/jobs`.
- `GET /`, `GET /health`: version, boot ID, busy state, process RSS and peak RSS.
- 429 means bounded queue/retention capacity, with Retry-After; normal contention
  does not produce 503. Invalid/oversized input returns 400/422/413.

Idempotency lasts for the result TTL. Records are not evicted early to admit more
work. The worker has no durable queue: boot change or unknown/expired job is reported
as WORKER_RESTARTED (possible OOM, not a proven diagnosis). Backend records the failed
attempt and automatically resubmits once with a new key; `autoResubmit:false` disables
this per job. A second restart ends FAILED. Cancellation and completed results persist
in the backend. Logs are bounded to 100 entries per job.

## Environment variables

| Worker setting | Default | Meaning |
| --- | --- | --- |
| `AI_SOLVER_WORKERS` | `1` | CP-SAT threads, range 1-8; retain 1 for reproducibility |
| `AI_SOLVER_PROFILE` | `low_ram` | Conservative CP-SAT defaults; `fast` disables presolve, symmetry, probing and linearization |
| `AI_SOLVER_MEMORY_MB` | `256` | CP-SAT memory safety parameter; not a hard RSS guarantee |
| `AI_JOB_MEMORY_MB` | `320` | Parent checks child peak RSS every 50 ms and kills excess |
| `AI_JOB_ADDRESS_MB` | `384` | POSIX hard RLIMIT_AS before solver import; virtual address space, not RSS |
| `AI_JOB_WALL_SECONDS` | `110` | Supervised child lifetime; overrides capped at 110 seconds, including startup/build/search |
| `AI_QUEUE_LIMIT` | `4` | Waiting jobs, in addition to one active/reserved job |
| `AI_QUEUE_WAIT_SECONDS` | `600` | Maximum queue wait before starting a job |
| `AI_JOB_TTL_SECONDS` | `1800` | Terminal results and idempotency TTL; cleanup every 30 s |
| `AI_JOB_CAP` | `100` | Maximum retained jobs including active jobs and cancellation tombstones |
| `AI_MAX_PAYLOAD_BYTES` | `2097152` | Actual streamed JSON bytes; independent of Content-Length |
| `AI_ROOM_MODEL` | `matching` | Exact Hall capacities + deterministic matching; `classic` for comparison |
| `AI_TEACHER_PREASSIGN` | `0` | Experimental balanced proposal; bounded trial then full-model fallback |
| `AI_DEBUG_NAMES` | unset | `1` retains CP variable names for diagnosis |
| `MALLOC_ARENA_MAX` | `2` in Docker | Set before Python starts in native deployment |
| `OPENBLAS_NUM_THREADS`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS` | `1` in Docker/children | Avoid transitive numeric thread pools |

Payload table caps: 100 teachers, 100 rooms, 100 groups, 500 subjects, 1000 registrations,
200 timeslots, 5000 teach rows. Registration × teacher × slot ceiling: 2,000,000.
Search input remains finite, >0 and <=120 seconds for compatibility. The worker
caps the combined model-build/search budget at 100 seconds and subtracts build time
before starting search. Once a valid timetable is found, optimization gets at most
five additional seconds (or the remaining budget, whichever is shorter). A timer
stops search even if no further improvement arrives. The best feasible timetable is
returned; minimum splitting need not be proven. The supervisor caps active child
lifetime at 110 seconds, including older AI_JOB_WALL_SECONDS=150 overrides.
Cold-start, network and queue waits are separate, so this is not a 120-second
end-to-end hosted SLA. Health does not acquire a solve lock.

The address-space cap is the hard allocation limit on Linux; the RSS watchdog is
sampled and may overshoot between checks. Windows uses the RSS watchdog and real child
PID (not the venv launcher), but does not implement RLIMIT_AS. Linux cap/import behavior
and Render compatibility are **not verified locally**; Linux CI exercises real spawn
solves with the cap enabled. If imports or allocations hit the cap, the job fails
explicitly rather than increasing limits silently. Size limits against the actual
instance and leave headroom for the web process, retained results, and the platform.
A whole-instance OS kill can still require restart recovery; no code guarantees zero
infrastructure failures.

| Backend setting | Default | Meaning |
| --- | --- | --- |
| `AI_BACKEND_JOB_TTL_SECONDS` | `86400` | Terminal job TTL |
| `AI_BACKEND_JOB_CAP` | `200` | In-memory/persisted job admission cap |
| `AI_WAKE_TIMEOUT_MS` | `90000` | Initial root request for cold start |
| `AI_JOB_WAIT_MS` | `900000` | Overall wait budget, preserved from original creation on restart |
| `AI_KEEP_WARM_SECONDS` | `0` | Disabled; positive value enables /health polling, minimum interval 60 s |

Keep-warm does not guarantee platform uptime. Firebase behavior is tested using a
persistent synthetic adapter and a real backend restart, not the live database.

## Additional mandatory rules (C24/C25)

C24 requires each group's lessons of a given subject to form one consecutive block
within each day. The subject may appear on multiple days. Period numbers define
adjacency: 1-2-3 is consecutive, 1-3 is not, and 4-6 does not bridge lunch at period 5.
Blocked or missing periods also break a block. C25 forbids lessons outside integer
periods 1-12; period 12 is allowed. The worker prunes these invalid candidates even if
the input CSV contains later slots. These rules are always enforced and cannot be
turned off through payload constraints. They do not replace any existing hard rules.

Required weekly hours are preserved: if lessons cannot fit before period 12 on one
day, the solver places the remaining lessons on another eligible day, consecutively
within that day. For example, four hours may use Monday 11-12 and Tuesday 1-2,
never Monday 11-14. Unavailable days may be skipped; no eligible space means
INFEASIBLE, not truncated hours or an exception to the period ceiling.

The solver minimizes the total number of daily blocks for subjects with more than
one required hour. It prefers placing a whole subject on one day rather than
scattering it across days; necessary splits use as few blocks as the search finds.
Lunch, blocked periods, teacher/room conflicts and other hard rules still apply.
`stats.objective` counts these blocks, `objectiveBound` reports the solver's lower
bound, and `blockOptimalityProven` distinguishes a proven minimum from a feasible
result at the time limit. This preference never relaxes C24/C25. An optimal result
under optional teacher preassignment is optimal only for that fixed assignment.

Backend validation checks C24/C25 before publishing SUCCESS, and the UI lists both
as mandatory. All three services need the new revision. Existing saved schedules can
fail these new checks; regenerate them. Impossible input remains INFEASIBLE, and
search exhaustion remains UNKNOWN; there is no fallback that disables the new rules.
Runtime `async-jobs-v4` identifies this revision. Hosted behavior remains not verified.

## Solver policy and benchmark

Backend `withHomeroom` makes a non-mutating augmented dataset: one HOMEROOM registration
per group, one hour, eligible teachers listed explicitly. Source CSVs stay unchanged.
C19 requires `student_group.advisor_id` matching a real teacher ID; it does not guess
from advisor names. C14 recognizes English IOT and Thai ไอโอที names. C20/C22/C23 are
hidden and rejected as unsupported, rather than pretending they optimize an objective.
Room classes follow the existing whole-subject C09 rule, and explicit room locks are
intersected. C12 reserves Wednesday 8-9 for activities. Approved joint pairs and one
teacher per registration are enforced. A sufficient registration conflict set is
returned for infeasibility; it is not claimed to be a minimal explanation.

From repository root (substitute your private archive path):

```powershell
.\.venv-diagnostic\Scripts\python.exe ai_worker/bench_memory.py 'C:\path\dataset.zip'
.\.venv-diagnostic\Scripts\python.exe ai_worker/bench_memory.py 'C:\path\dataset.zip' --http
$env:AI_SOLVER_PROFILE='fast'
.\.venv-diagnostic\Scripts\python.exe ai_worker/bench_memory.py 'C:\path\dataset.zip' --http
.\.venv-diagnostic\Scripts\python.exe -m unittest discover -s ai_worker -p 'test_*.py'
npm --prefix backend test
npm --prefix frontend run build
```

The benchmark uses backend CSV parsing, `withHomeroom`, `buildSolverPayload`, and
`validateSchedule`. It prints only aggregate metrics and rule outcomes, never CSV
contents or output schedules. `--without-homeroom` exists for reproducing the old
65-registration baseline. `AI_SOLVER_BENCH_PARAMS` accepts a JSON object of the five
parameter knobs documented in `runtime_config.py`; it is a server-side benchmark
setting, never a client payload override. See HANDOFF.md for measured comparisons.
