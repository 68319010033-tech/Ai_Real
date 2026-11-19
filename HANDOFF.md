# Ai_Real continuation handoff

## No isolated subject lessons — 2026-11-19

User confirmed no one-period fragments, allowing multiple blocks such as 3+3,
2+2+2 and odd totals 3 or 3+2. Added always-on C26: for subjects requiring more
than one weekly hour, each occupied day has at least two periods. C24 still makes
them consecutive and allows only one daily block. Subjects requiring exactly one
hour remain exempt, preserving homeroom. No weekly hours are dropped. Period 12
remains allowed, later periods forbidden. No payload override can relax C26.

Backend validation independently detects single-period fragments and uses required
subject hours for the one-hour exemption (not the possibly truncated output count).
UI lists C26 as mandatory. Payload records minSubjectBlockPeriods=2. Runtime v6.
Deploy AI, backend and frontend revisions together; no deployment performed here.

74 worker tests, 35 backend tests and frontend build pass. Private dataset via local
HTTP: SUCCESS in 9.931 seconds, C01-C13/C24-C26 all pass, child peak 146.203 MB,
combined upper bound 193.477 MB. Objective 82 blocks, optimality not proven.
The previous test allowing 2+1 overflow was updated to 2+2 because the user changed
that rule. Added explicit rejected singleton remainder and valid odd-total cases.

## Faster cloud scheduling follow-up — 2026-11-19

Public production /health was read-only checked: async-jobs-v4, not busy, one search
worker. No private dataset was sent to production and no deployment was performed.
The user still observes >120 seconds end-to-end; cold starts/queues remain separate
from active solve time. Current v4 health does not identify the selected profile.

Promoted the measured fast profile to default (explicit low_ram remains supported).
The model and all hard constraints are unchanged. v5 /health exposes solver_profile,
active_wall_limit_seconds and queued_jobs. An existing AI_SOLVER_PROFILE=low_ram
override must be removed or changed to fast by the deploying owner. Only the AI
service requires deployment for this update; backend/frontend protocol unchanged.

Real private dataset, local HTTP, requested 120 seconds, one thread:
- Prior low_ram run: 53.254 s, objective 121, combined upper bound 205.352 MB.
- Fast seed 1: 9.381 s, first solution 0.277 s into search, objective 93,
  combined upper bound 194.434 MB.
- New default fast seed 2: 9.368 s, first solution 0.261 s into search, objective 93,
  combined upper bound 193.629 MB.
All mandatory C01-C13/C24/C25 checks pass. Objective counts multi-hour subject blocks;
optimality is not proven. Bench utility now accepts --seed and reports actual profile.
68 worker tests pass with the new default. Hosted timing remains unverified.

## Scheduling time fix — 2026-11-19

Based on integration ef49196 (merged PR #9). Merge resolution had retained two
consecutive-block models, two objectives, and a duplicate objective statistics key.
Removed the redundant model and retained C24/C25 with whole-block minimization.
Restored default maxPeriod=12; the merged default 11 broke five existing tests.
Explicit stricter maxPeriod settings remain supported.

Build plus search is capped at 100 seconds; build time is deducted from search.
After the first valid solution, a five-second timer stops further optimization,
even when no more solutions arrive. The supervisor caps child lifetime at 110
seconds even with an old 150-second environment override. Queue/cold-start/network
time is separate. Budget exhaustion without a solution remains UNKNOWN, never
INFEASIBLE. Runtime marker: async-jobs-v4. All hard rules and weekly hours remain.

Verification: 67 worker tests, 33 backend tests, frontend build. Tests cover budget
deduction, improvement timer lifecycle/no subsequent solutions, old environment
override clamping, and the existing wall-limit process termination coverage.
Final local private-dataset HTTP run with requested 120 seconds: SUCCESS in 53.254 s,
all C01-C13 and C24/C25 pass; first solution at 45.729 s of search, search stopped
at 50.769 s. Child peak 153.895 MB; combined upper bound 205.352 MB. Objective 121,
bound 49, optimality not proven. Local observation, not hosted performance proof.

## Follow-up — prefer whole-subject blocks

The user clarified that subjects should stay in one whole block whenever possible,
with cuts across days when necessary. The solver now minimizes the total occupied
days for multi-hour group/subject registrations. C24 makes each occupied day one
block; C25 still forbids periods after 12. Exact weekly hours remain mandatory.
Single-hour subjects contribute a constant and are omitted from the objective.
Per-registration lower bounds use the longest eligible consecutive run and daily
limit, ignoring resource competition. Lunch and all other hard rules still apply.

Stats expose `objectiveName: multiPeriodSubjectBlocks`, `objective`,
`objectiveBound`, and `blockOptimalityProven`. A time-limited FEASIBLE result is a
valid schedule, not a guarantee of minimum splitting. With optional teacher
preassignment, optimality is conditional on those fixed teachers.
Tests cover moving a whole three-hour block to a day that fits, choosing two rather
than three days when splitting is necessary, and a 14-hour subject in two legal
daily blocks. Verification: 64 worker tests and frontend production build.

Final local real-dataset HTTP benchmark (low_ram, seed 1, 60-second search):
SUCCESS, C01-C13 and C24/C25 pass; 63.076 s HTTP wall, 1.685 s build,
60.007 s search, 154.977 MB child peak, 52.629 MB server peak, 207.605 MB
combined upper bound. Objective 120 blocks for multi-hour registrations, lower
bound 49; minimum NOT proven. Model: 15,639 variables / 6,881 constraints.
This optimization can consume the full search budget; the earlier feasibility-only
timings below do not describe the new objective. No hosted deployment performed.

## Latest patch — 2026-11-19 consecutive subjects and period 12 ceiling

Branch: `codex/consecutive-subject-period-limit`, based on merged PR #7 (3755ed3).
User explicitly chose: on each day, a subject's lessons must be consecutive; subjects
may span multiple days. Implemented always-on C24 per group/subject/day, and C25
restricting lessons to integer periods 1-12 (12 included). Lunch, missing periods,
and blocked periods break a block. No soft penalty or fallback may violate these.
The follow-up explicitly requires overflow beyond period 12 to use another eligible
day. Exact weekly hours plus C24/C25 enforce this without a post-solve move that
could introduce clashes. Regression tests cover overflow, skipping a blocked day,
and insufficient remaining space (INFEASIBLE).
Backend validation and mandatory UI labels match. Saved policy records the new rules;
old saved timetables must be regenerated if they fail them. Runtime: async-jobs-v3.

Reproduced before change: a single required lesson in period 13 returned SUCCESS,
and two lessons of the same subject in periods 1 and 3 returned SUCCESS. Both cases
are now INFEASIBLE; a forced daily gap reports C24 in its sufficient conflict set.

Local real dataset: 73 registrations, seed 1, one solver thread, 60-second limit.
Both profiles return SUCCESS and pass C01-C13 plus C24/C25 via the HTTP job API.

| Configuration | HTTP wall s | Build s | Search s | Child peak MB | Server peak MB | Combined peak upper bound MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before new rules, previous default run | 10.460 | 1.684 | 7.007 | 131.750 | 47.047 | 178.797 |
| New hard rules, low_ram default | 24.425 | 2.703 | 19.324 | 146.137 | 49.270 | 195.406 |
| New hard rules, fast opt-in | 6.303 | 2.582 | 0.405 | 131.980 | 47.219 | 179.199 |

Single local observations, not a controlled CPU benchmark or Render guarantee. The
model grows from 11,744 variables / 2,627 constraints to 15,343 / 6,521. Default profile
is unchanged; fast remains opt-in. Rules are enforced with one block-start transition
per group/subject/day, keeping missing/lunch periods as zero occupancy.

Verification: 61 worker tests, 33 backend tests, frontend production build. New cases
cover end-at-12, period 13/fractional/invalid periods, gaps/lunch/blocked periods,
multi-day blocks, unordered CSV rows, intervening subjects, approved joint pairs,
and matching backend checks. Production deployment, live scheduling, and timings on
Render are **not verified**. The owner continues to handle AI deployment; their friend
handles backend/frontend. No source CSVs or generated personal schedules are committed.


## PR #7 merge preparation — 2026-11-18

Merged current integration into the PR branch to resolve overlapping worker/validator
changes. Preserved the teammate's timetable display improvements, teacher/room names,
explicit registration-teacher selection, sorted solver output, and worker rule opt-out
compatibility. Retained the async job path and explicit advisor_id policy; production
routes use dataset.withHomeroom, not the older name-matching helper.

After resolution: 49 worker tests, 29 backend tests, and frontend build pass locally.
The 73-registration HTTP benchmark still passes C01-C13 (10.460 s wall, 1.684 s build,
7.007 s solve, 178.797 MB combined peak upper bound; run alongside local tests).
GitHub PR workflow for d925477 passed. New merge-resolution commit checks must pass
before merging PR #7. Production Render deployment remains not verified.



## Latest patch — 2026-11-18 async jobs and measured room optimization

Current branch: `codex/reliable-timetable-jobs`. This section supersedes older claims
about missing activity/homeroom/room-type enforcement. The user requested a fresh
branch, no pushes to integration, no credential reading/printing, measured changes,
and explicit unverified items. No credentials or private CSV/timetable data were
read from credential files or added to source control. The supplied CSV archive was
read only for local computation; benchmarks print aggregates only.

The owner confirmed that only the AI deployment belongs to them; frontend/backend
belong to their friend. Render returned `null` services in the confirmed workspace.
The supplied project dashboard opened a sign-in screen. The user then explicitly
said **“Leave it I Do This Myself”**: deployment is left to the user, no service was
deployed or reconfigured, and no teammate was contacted.

### Implemented

- FastAPI async job API with required idempotency key, payload fingerprint conflicts,
  one spawned child at a time, four queued jobs, progress/elapsed/queue position,
  bounded logs/results/TTL, cancellation including pre-submit tombstones, boot IDs,
  cheap HEAD/root/health/favicon, byte/count/schema caps, structured request-ID logs.
- Per-child wall timeout, sampled RSS kill, POSIX hard virtual address-space cap;
  web process never imports OR-Tools. Results preserve solver status and stats.
  `/solve` and `/cancel` remain available on the same queue/core. Docker uses one
  Uvicorn process, PORT, bounded graceful shutdown and numeric-library thread limits.
- Backend short polling, bounded exponential transient retries, wake-up state,
  request IDs, one active job per user (409), abort + worker cancellation, restart
  detection and one automatic resubmission with failed-attempt history. Results are
  validated before publication. Explicit error classes distinguish infrastructure,
  invalid input, queue/wake, time limit, and proven infeasibility.
- Firebase job persistence using existing configuration, startup recovery, serialized
  writes, bounded job/log/latest-result retention; in-memory fallback without Firebase.
  `/generate` is now an async alias of `/solve-jobs`, returning 202/jobId; callers must
  poll. This backend route migration does not change worker `/solve` compatibility.
- Frontend shows wake/queue/elapsed/error/restart status, polls at 2.5 s, attaches to
  existing job on 409, and displays friendly gateway/network messages. Search default
  is now 60 seconds. C20/C22/C23 are hidden and rejected rather than silently ignored.
- Exact Hall-capacity constraints replace integer room variables for ordinary room
  domains. Deterministic bipartite matching assigns rooms afterwards. All unions of
  distinct allowed-room sets are constrained, so this is exact, not a heuristic
  room-class approximation. If union closure exceeds 128 sets, use the original
  integer-room model. No no-good loop is necessary with complete Hall constraints;
  an unexpected matching invariant failure returns MODEL_INVALID, never SUCCESS.
- Mandatory activity slots, whole-subject C09 room rules, one teacher per registration,
  and non-mutating `withHomeroom` augmentation now produce C01-C13 passing real output.
  Approved joint pairs remain unchanged. C19 uses explicit optional `advisor_id`;
  selecting it without valid mapping fails clearly, never invents a name match.
- Owner answered “Find Yourself suitable” on C14. Read the four supplied subject names:
  all explicitly contain Thai ไอโอที. Extended the existing name predicate to
  `/iot|ไอโอที/i` in builder and validator, covering 31901-2013, 20901-2406,
  20901-2407, 20901-9203 without inferring from IDs alone.
- Infeasible models return a sufficient registration conflict set with IDs and reason
  (not claimed minimal); no eligible slot/teacher produces a specific reason. Solver
  UNKNOWN remains a time limit, not INFEASIBLE. Malformed references are invalid input.
- Optional deterministic teacher pre-assignment with bounded trial/full-model fallback
  is implemented and tested, but remains OFF after measurement showed overhead.
- GitHub Actions added for worker tests on Linux, backend tests, frontend build on every
  push/PR. Actual hosted CI execution is **not verified** until pushed/run.

### Reproducible measurements (local Windows, one CP-SAT thread, seed 1)

Same private ZIP documented below, via backend CSV parser and payload builder. Original
checkout had no `withHomeroom`, despite newer assumptions in the request; baseline
therefore has 65 registrations. The corrected runs have 73 (eight homeroom), 60 slots,
22 rooms, 8 groups, 18 teachers, 42 subjects. Search budget 60 s. All rows below are
single observations, not statistical estimates or Render timings. Wall includes
matching/cleanup; build/search stats can sum to less than wall.

| Step / configuration | Status | Wall s | Build s | Solve s | Peak RSS MB | Vars / constraints | C01-C13 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Checked-out baseline, 65 registrations, classic rooms | SUCCESS | 23.161 | 1.189 | 21.860 | 326.672 | 9064 / 11081 | C09 fail 92, C12 fail 21, C11 unresolved |
| Room model only, same 65 registrations | SUCCESS | 1.273 | 0.408 | 0.787 | 95.004 | 5022 / 2997 | C09/C12 still fail; C11 unresolved |
| Rule alignment + one teacher + 8 homerooms, conservative parameters | SUCCESS | 5.241 | 1.046 | 4.093 | 130.039 | 11744 / 2627 | all pass |
| Same 73, fast profile | SUCCESS | 1.445 | 1.210 | 0.134 | 118.227 | 11744 / 2627 | all pass |
| Same 73, default + max_presolve_iterations=1 | SUCCESS | 3.460 | 1.104 | 2.255 | 129.293 | 11744 / 2627 | all pass |
| Same 73, default + symmetry_level=0 | SUCCESS | 5.977 | 1.411 | 4.468 | 129.344 | 11744 / 2627 | all pass |
| Same 73, default + cp_model_probing_level=0 | SUCCESS | 2.217 | 0.994 | 1.096 | 124.309 | 11744 / 2627 | all pass |
| Same 73, default + linearization_level=0 | SUCCESS | 5.329 | 1.181 | 4.052 | 122.465 | 11744 / 2627 | all pass |
| Same 73, fast + teacher proposal (fell back) | SUCCESS | 2.044 | 1.283* | 0.126* | 118.000 | 11744 / 2627 | all pass |
| No debug names + GC, local HTTP, low_ram | SUCCESS | 8.204** | 1.401 | 5.145 | 131.605 child | 11744 / 2627 | all pass |
| No debug names + GC, local HTTP, fast | SUCCESS | 3.073** | 1.296 | 0.180 | 119.645 child | 11744 / 2627 | all pass |

\* Build/search for the fallback only; outer wall includes the rejected trial.
\*\* HTTP wall includes process startup, polling and response serialization. The low_ram
server peak was 47.191 MB; sum of server and child peaks **178.797 MB**. Fast server
peak 46.039 MB; combined conservative upper bound **165.684 MB**. The earlier 135 MB
combined estimate used Windows' small venv launcher PID and was discarded/corrected.
The manager now spawns using the real interpreter on Windows; server reports its own
RSS rather than relying on launcher PID. No Linux/Render memory claim follows from
these Windows measurements.

Import breakdown in a fresh process with one numeric thread: Python 10.63 MB; after
NumPy 21.13 MB; after pandas 52.99 MB; after OR-Tools 57.91 MB. OR-Tools imports pandas
transitively in this version. We did not patch third-party imports. The task's prior
83 MB baseline and 384/468 MB peaks were supplied evidence from a different revision/
measurement setup, not reproduced numbers for this checkout.

Decision: retain conservative `low_ram` default until actual Render sizing is known;
`fast` is opt-in and was both faster and smaller on this dataset after removing room
variables. Do not infer that result for arbitrary data/instances. Teacher preassignment
was slower due to fallback and remains off. Group-by-group decomposition and greedy
warm-start scheduling were not implemented/benchmarked; current exact model already
meets the local speed/RAM target, and those hypotheses remain **not verified**.

Final serialized HTTP reruns, saved as aggregate-only JSON in
`diagnostics/reliability/benchmark-low_ram.json` and `benchmark-fast.json`:

| Profile | HTTP wall s | Build s | Solve s | Child peak MB | Server peak MB | Combined upper bound MB | C01-C13 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| low_ram (default) | 6.914 | 1.204 | 4.276 | 131.355 | 47.551 | 178.906 | all pass |
| fast (opt-in) | 3.552 | 1.261 | 0.142 | 119.699 | 46.645 | 166.344 | all pass |

### Verification evidence

- Baseline: 24 Python tests, 9 Node tests passed before changes.
- Latest local suites: 44 Python tests and 26 Node tests passed; frontend production
  build passed (existing large ExcelJS bundle warning). See commands in DEPLOYMENT.md.
- Tests cover real spawned child kill/abnormal exit/wall/RSS limits, health during work,
  queue cap/cancel/shutdown/TTL/idempotency, actual whole-worker restart/boot change/404, actual HTTP 202/413/422/legacy solve shape,
  cancellation-before-POST race, exhaustive 512 small room-domain matching/Hall cases,
  classic-vs-matching equivalence, one-teacher infeasibility, teacher fallback,
  seed determinism, activity slots, and explicit advisor mapping.
- Node HTTP stub tests inject 502/503/504 on POST and poll, dropped POST response,
  cold-start delay, one/two worker restarts, invalid input, UNKNOWN and INFEASIBLE.
  Failures end in named errors, never bare Axios gateway errors or false INFEASIBLE.
- A separate actual backend process is killed mid-job and restarted against a synthetic
  file-backed Firebase-compatible adapter. It resumes the same worker ID/key and
  completes, with 409 and cancellation also checked. Real Firebase is **not verified**.
- Local HTTP benchmark: backend buildSolverPayload(withHomeroom) -> worker /jobs ->
  backend validateSchedule: C01-C13 all pass at one solver thread and 60-second limit.
  Uploaded source rows and output schedule are never saved by the benchmark.

### Data/policy issues retained, not silently repaired

- Corrupted room ID `R??????`: source is unchanged; previously reported use in 11 lessons
  is historical/user-supplied, not reverified for the new schedule.
- Subject 21901-2012 possible name typo: unchanged; correctness of the name **not verified**.
- Subject 21906-2006 exists in the supplied source and has **0 registrations**, verified
  by CSV parsing. No registration invented. One source room ID contains question marks,
  also verified; it remains unchanged.
- T07 reported at 41 lessons/week: no load cap or eligibility changes invented; final
  teacher-load count **not verified** beyond existing collision/required-hours checks.
- C19 actual advisor mapping is still the owner's data task. No adviser names matched.
- C14 now recognizes all four literal Thai IOT names; institution-specific room-lock
  appropriateness beyond the supplied rule and those names is **not verified**.

### Deployment and remaining verification

See `ai_worker/DEPLOYMENT.md` for API, all limits, env vars, rollout and commands.
**not verified**: real Render instance size, Linux RLIMIT_AS import/solve behavior,
Docker build/run, production Firebase access/index, hosted CI run, visual interaction
with the updated frontend, any hosted dataset solve after this patch, no stacked 503s,
no unexplained worker restarts, and hosted elapsed time below the chosen limit.
No local WSL Linux distribution/Docker runtime was available for Linux verification.

Memory isolation is not a claim that any platform OOM can never kill the web process:
POSIX hard address-space cap is 384 MB; sampled RSS stop is 320 MB; web/job retention
needs additional headroom. Windows does not provide the POSIX cap and uses supervision.
Operate one worker and one backend process/replica. In-memory mode cannot preserve
jobs after backend process loss; Firebase mode can. Worker TTL expiry is distinguishable
from infeasibility but reported with restart/expired-job recovery semantics.

## Latest patch — worker/validator alignment

- `ai_worker/solver.py` now enforces C09 (room type from theory/practice, same predicate as validator; opt-out `enforceRoomType:false`) and C12 (activity subjects only Wed periods 8–9, others excluded there; opt-out `enforceActivitySlots:false`). One teacher per group/subject; `register.teacher_id` honoured when it is in `teach`. Output sorted.
- C11: `backend/src/lib/homeroom.js` adds a virtual `HOMEROOM` subject (1 theory period, one per group) at solve and validate time when the CSV has none; advisor matched by teacher id/name (C19), otherwise any teacher. Disable with `AUTO_HOMEROOM=false`. Stored datasets are not modified.
- Backend forwards `seed` to the worker in `/solve-jobs` and `/generate`.
- Tests: 29 worker tests, 12 backend tests pass; synthetic end-to-end (backend payload -> worker -> validator) passes C01–C13.

## Latest patch — 2026-11-17 resource safeguards

User reported 502 still recurs and explicitly requested fixing it now. Implemented default one CP-SAT search worker (server-owned AI_SOLVER_WORKERS, range 1–8), a per-process nonblocking solve lock, HTTP 503/Retry-After for busy workers, async health endpoint with version `resource-safe-v1`, request-ID/count/timing logs, exception-safe lock release, bounded search input, Docker PORT binding with one Uvicorn process, and backend error classification. HTTP 400 is no longer automatically labeled INFEASIBLE.

Verification: 20 solver tests + 4 runtime tests + 9 backend tests pass; local HTTP smoke passes. Actual approved-pair CSV run: SUCCESS, 237 rows, 18.605 s, one search worker. Core checks plus C10/C13 pass, remaining C09/C12/C11 limitations persist. Evidence is in resource-safe diagnostic logs. See `ai_worker/DEPLOYMENT.md` for exact deployment and verification steps.

This is a mitigation for demonstrated concurrency/resource risks, NOT proof of the original 502 cause or a hosted fix. New code is prepared for publication on `codex/fix-ai-timeout`; remote commit should be checked with git. No direct production deployment has been performed. Worker and backend must both deploy the new code; frontend need not change. Do not resume unrelated activity-rule work until this production stability task is handled.

## Live 502 investigation — 2026-11-17

### Follow-up with confirmed AI URL

- User supplied `https://ai-real-ek52.onrender.com/` and confirmed the friend's backend AI_WORKER_URL matches it.
- Direct root health check: HTTP 200 in 0.18 s, `AI Worker is running`.
- Direct synthetic one-lesson POST /solve: HTTP 200 SUCCESS in 0.13 s; real room assigned and build/search statistics returned.
- One larger synthetic request (65 registrations, 55 slots, 22 rooms; no personal data) returned HTTP 200 UNKNOWN after 34.57 s, with build=3.895 s, search=30.213 s. It did NOT return 502.
- Retried the previously authorized uploaded real dataset once through the existing logged-in frontend, unchanged defaults (30 s, seed 1, no extra rules). UI now shows completed with solver UNKNOWN / time limit reached, not failed/502. Screenshot: ignored `diagnostics/timeout/real-data-local/live-unknown.jpg`.
- No code or deployment was changed between the observed 502 and the successful HTTP response. Therefore the original 502 is intermittent/unexplained, not proven fixed. Do not assert cold start, OOM, or URL mismatch as root cause. Hosted compute does not currently find a timetable within the default search budget, whereas local runs did.
- Proposed next step, pending step-by-step approval: evaluate worker concurrency/resource usage and test a configuration suited to hosted compute. Avoid merely increasing HTTP timeout or claiming UNKNOWN means infeasible. Runtime logs at the original failure would still be needed to establish the 502 cause.

- Fix commit `41266e8f1022a98c8b9ea85eb0c4572e6bcf4fd6` was pushed to `codex/fix-ai-timeout` and verified by fetching. The older publication-pending notes below are historical. A later read of GitHub integration shows the optimized solver there too; live deployed commit is still unverified.
- User reports 502 during AI processing and supplied the frontend URL and login credentials. Credentials were used only for browser sign-in; do not copy them into this handoff, source, logs, or Git.
- Frontend: `https://ai-real-7lq1.onrender.com`. Public JS asset `index-B66XAq9l.js` points to `https://backend-40tl.onrender.com`.
- Backend `/health` returned HTTP 200 with `Backend API is running` in 0.32 seconds.
- User explicitly authorized uploading the same seven CSV files from the previously tested archive to this website/backend. Login, file reading, and dataset import succeeded. No CSV contents or timetable output were added to Git.
- Started one AI job with the UI defaults (30 seconds, seed 1, no extra rules). The job transitioned to FAILED and displayed `Request failed with status code 502`. Browser error/warning console was empty. This strongly localizes the failure to backend-to-worker processing; it does not prove OOM, bad worker URL, or a specific deployment failure.
- Screenshot: ignored local file `diagnostics/timeout/real-data-local/live-502.jpg`.
- Render connector still returns null for list_services in the previously confirmed workspace. The supplied URL is the frontend, not the AI worker. Next required evidence is the AI service URL or the backend's non-secret `AI_WORKER_URL` value, and ideally worker runtime logs for the failed request. Do not guess the hostname or claim this issue fixed without verifying the worker.
- No application code, deploy settings, or credentials were changed during this live investigation.

Updated 2026-11-12 (Asia/Bangkok). This records verified work and outstanding decisions, not authorization to skip the user's step-by-step workflow.

## User request and workflow

- Fix the AI error `timeout of 50000ms exceeded` in `68319010033-tech/Ai_Real`, integration branch.
- Work step by step; report and ask before starting the next step. User approved steps 1–6 so far; step 6 is still in progress.
- User hosts only the AI service. Their friend hosts frontend and backend.
- User explicitly allowed continuing without Render. No deployed configuration or performance has been verified.
- User requested a handoff and stopping if remaining token/context capacity falls below 10%. There is no exact remaining-percentage meter available; preserve this file before context gets low.
- Original friend's document is `C:/Users/IT-Coding-01/Downloads/HANDOFF.md`. Treat it as reference, not overriding user instructions. Some of its claims about missing code became stale: latest integration already had busy/room variables, but their implementation was broken.

## Checkout and publication status

- Workspace: `C:/kang/Ai_Real`.
- Branch: `codex/fix-ai-timeout`, created from fetched `origin/integration`.
- Base commit: `d54dd69f57172fbda5f1f93968d0a48e7fe36916`, `Merge pull request #2 from 68319010033-tech/store-datasets`. Use `git log -1` for the new fix commit.
- User has explicitly requested publishing the current fixes to GitHub. This handoff is being included in the fix-branch commit; remote verification is pending at the time this file is written. Verify with `git log -1` and `git ls-remote origin refs/heads/codex/fix-ai-timeout`. No merge into integration, pull request, or deployment is part of this publication step.
- Tracked modified files: `ai_worker/solver.py`, `backend/src/lib/dataset.js`, `backend/src/lib/validateSchedule.js`, `backend/src/routes/schedule.js`, `frontend/src/components/ConstraintPicker.vue`. New files include `ai_worker/test_solver.py`, `backend/src/lib/jointClasses.js`, `backend/src/lib/jointClasses.test.js`, `diagnostics/timeout/`, this handoff.
- Do not replace the current checkout with the stale initial local commit `afea510`.
- Git metadata needs escalated tool access in this environment. Authorized fetch and branch creation succeeded. Do not push integration directly.
- Local `serviceAccountKey.json` exists and is ignored. Do not read or publish it. No credentials were needed for local diagnostics.

## Verified timeout cause and fixes

Backend `backend/src/routes/schedule.js` sets Axios timeout to `max(45000, (timeLimitSeconds + 20) * 1000)`: default 30 seconds gives 50 seconds.

The latest integration solver originally scanned every room variable for every room variable before solver search, outside CP-SAT's search time limit. A synthetic 40-registration case exceeded 55 seconds without reaching search. Tiny cases returned SUCCESS with zero rows because room choices were optional.

Implemented locally:

1. Index assignments by registration, teacher/slot, group/slot, group/day instead of rescanning all variables.
2. Each active teaching event must select exactly one real room. Each inactive event has its own negative sentinel room ID. One integer room variable per event plus AllDifferent per slot enforces collision-free assignment without hundreds of thousands of room booleans.
3. Non-joint lessons cannot share a teacher or room merely because they have the same subject. Worker supports explicit `jointMode=together` for legacy/direct requests and now `jointMode=pairs` with a subject-to-pairs map. Backend sends the user-approved pairs from `jointClasses.js`. Unpaired registrations study alone. Pair config rejects overlapping groups, unregistered groups, and non-pairs.
4. Teacher-specific blocked slots no longer inadvertently block all teachers.
5. Real build/search stats and logs, worker seed default 1, proper UNKNOWN/MODEL_INVALID/INFEASIBLE distinction.
6. Step 6: enforce C10 for roles containing `leader` case-insensitively (same predicate as backend): Tuesday period 8 unavailable. Existing UI and validator already treat this as mandatory. Other teachers may use that slot.

7. Backend sends the approved pair policy and stores resolved `payload.constraints` with schedules through both solve routes. Validator uses saved policy when available, otherwise current approved policy; C06/C07/C13 reject wrong pairs and triple classes. UI C13 text describes the approved pairing policy.

Backend timeout remains unchanged. These pairing changes require both the user's AI service and their friend's backend to be updated when eventually deployed. Frontend change is display text only; frontend dependencies are absent locally, so no frontend build was run.

## Real data and results

Input: `C:/Users/IT-Coding-01/Downloads/CSV-20261110T081449Z-1-001.zip`.
SHA256: `eb13af31a67f03cff0595de06e4dc4a5cbd948f0076baf67fc2d5cc1137c2cf3`.
Contains 18 teachers, 22 rooms, 8 groups, 41 subjects, 50 teach rows, 65 registrations, 60 timeslots. Friend's handoff said 48 teach rows; don't assume identical input.

Tests use the actual Node backend CSV parser and `buildSolverPayload`, then run the Python worker. Earlier runs used jointMode=none. The latest run uses the approved pair policy, no extras, roomTypeMatch=false, maxPeriodsPerDay=10, search limit 30 s, seed 1, eight workers. **No rules were disabled just to obtain a solution.**

Timings (single local runs, not hosted guarantees):

| Stage | Time | Model vars | Result |
| --- | ---: | ---: | --- |
| Step 4 first fix | 44.177 s | 209,990 | 237 rows |
| Step 5 compact rooms | 18.552 s | 9,130 | 237 rows |
| Step 6 C10 enforced | 15.986 s | 9,064 | 237 rows |
| Step 6 approved pairs | 17.045 s | 9,064 | 237 rows |

Latest actual-data checks: C01–C08, C10, and C13 pass. C09 fails (90 room-type violations); C12 fails (18 activity-slot violations); C11 homeroom unresolved. C14–C18 inactive. Counts can vary as solver chooses another solution. **Candidate timetable is NOT approved for submission.**

Latest regression suites: 20 Python tests pass (`pairs-regression-results.txt`) and 6 Node tests pass (`pairs-backend-results.txt`). Includes mandatory rooms, missing rooms, locks, collisions, joint pairs plus standalone third group, invalid pair config, singleton groups, inactive room candidates, room-type/lock intersection, teacher-specific blocks, lunch/daily limits, leader meetings, exact approved-pair validation, and saved-policy validation. Local FastAPI success/infeasible smoke checks passed at Step 5; not a hosted test. Node route syntax and git diff checks pass.

## Current policy decisions and unanswered questions

User explicitly answered the joint-class question: **“Pairs only; decide separately for three-group subjects.”** Do not use all-three-together as default or silently choose a pair.

Both follow-up questions are answered and implemented:

1. `30000-1201`, `30000-1404`, `30000-2002`: **G3 + G4 together; G5 separately**.
2. `20000-1208`, `20000-1402`, `20000-2007`: **G7 may study alone**.
3. G1/G2 study together for their two-group subjects `30000-1501`, `30000-1202`, `30000-2004`.

`backend/src/lib/jointClasses.js` contains this explicit project policy. It only activates approved pairs whose two members are registered for the subject; new unrelated subjects are not assigned invented partners. A future dataset needing different pairs requires a policy update or a configuration UI (not implemented).

Other outstanding policy/data issues:

- C09: UI/backend validator enforce whole-subject classification: theory-only uses Theory room, any practice uses non-Theory. Worker reads a `subject.room_type` field absent from CSV and backend payload, and roomTypeMatch is false by default. Clarify whole-subject vs separate theory/practice periods before implementing a new interpretation.
- C11: No homeroom subject exists in the CSV. Do not invent a subject or claim pass. Need user input if homeroom must be added.
- C12: Activity subjects identified from names: `30000-2004`, `30000-2002`, `20000-2007`, each practice=2, theory=0. UI and validator require Wednesday periods 8–9 and forbid non-activity subjects then. Solver does not enforce this currently. Pair grouping decisions are now settled; activity timing is the proposed next step. Do not relax teacher/room collision rules if conflicts appear.
- CSV roles are exactly Leader (8) and Teacher (10), resolving old handoff's uncertainty. Leader IDs: T01,T03,T06,T08,T09,T10,T11,T17.
- `buildSolverPayload` now sends the approved jointMode and jointPairs. UI `GenerateView.vue` sends seed, but backend still doesn't forward it to worker; worker uses seed 1 by default. No user-editable pair configuration UI exists.
- Backend C13 validator now checks exact approved pair membership, including rejection of triples and acceptance of approved singletons.
- UI currently labels C01–C13 all mandatory despite current worker defaults not enforcing all. Avoid presenting partial success as full compliance.

## Reproducible commands and artifacts

PowerShell from `C:/kang/Ai_Real`:

```powershell
.\.venv-diagnostic\Scripts\python.exe -m unittest discover -s ai_worker -p test_solver.py -v
.\.venv-diagnostic\Scripts\python.exe diagnostics/timeout/real_data_check.py 'C:\Users\IT-Coding-01\Downloads\CSV-20261110T081449Z-1-001.zip'
.\.venv-diagnostic\Scripts\python.exe diagnostics/timeout/http_smoke.py
node --test backend/src/lib/jointClasses.test.js
git diff --check
git status --short
git log -1 --format='%H %s'
```

Python environment `.venv-diagnostic` is ignored and installed with `ai_worker/requirements.txt`; Python 3.10.9, OR-Tools 9.8.3296. Node v26.13.0 available. Initial package download needed sandbox escalation, then succeeded. No need to reinstall.

`diagnostics/timeout/README.md` contains detailed evidence. Raw console logs: `results.txt` (original bug), `fixed-results.txt`, `real-data-run.txt` (Step 4), `step5-real-data-run.txt`, `step6-real-data-run.txt`, `pairs-real-data-run.txt` (latest), and regression/HTTP logs.

Original solver preserved in `solver_snapshot.py`; Step 4 solver in `solver_step4_snapshot.py`. These are diagnostic snapshots, not application entry points.

Full user-data output is in ignored `diagnostics/timeout/real-data-local/`: worker-result.json, backend-validation.json, summary.json, candidate-not-approved.csv. These now represent the most recent Step 6 run; step4-summary.json and step5-summary.json preserve earlier summaries. Do not commit user timetable data by force-adding ignored files.

## Next action

The pairing increment is complete and verified. Ask before proceeding to the next step: enforce the existing activity-period rule, then resolve room-type policy and homeroom data. Keep user-approved pair/singleton decisions unchanged. No production access is required for local fixes, but a future deployment must coordinate with the friend hosting backend/frontend. No pairing questions remain pending.
