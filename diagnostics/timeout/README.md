# AI timeout diagnostic and local fix

The initial regression fixtures are synthetic. Step 4 also tested the CSV archive found in Downloads, as recorded below. No production deployment, push, or live Render verification was performed.

Base commit (`git log -1`): `d54dd69f57172fbda5f1f93968d0a48e7fe36916` — Merge pull request #2 from 68319010033-tech/store-datasets.
Working branch: `codex/fix-ai-timeout`.
Original solver blob: `9cd14b14806dea4ff1dccd968e6f2f62af4d0f64`, preserved in `solver_snapshot.py`.

## Findings and changes

The original room loop scanned every room variable once for every room variable, before the search timeout began. It also allowed all room variables to be false, yielding SUCCESS with no timetable rows.

The fix indexes assignments by registration, group/slot, group/day, teacher/slot, and room/slot. Every selected assignment has exactly one room. Room capacity counts actual teaching events once; only explicitly enabled joint lessons can share an event. Joint groups use the same teacher, time, and room. Separate lessons cannot silently share a teacher or room even if their subject IDs match. Teacher-specific blocking no longer blocks every teacher. The worker returns measured build/search statistics and preserves UNKNOWN versus MODEL_INVALID versus INFEASIBLE.

The backend's 50-second default request timeout is unchanged. The latest worker's default `jointMode=none` is preserved; this change does not decide the user's joint-class policy or add a frontend control. The backend currently does not forward jointMode or seed through its payload builder; the worker tests set these directly. Production dataset testing remains necessary.

## Commands

Run from the repository root in PowerShell:

```powershell
.\.venv-diagnostic\Scripts\python.exe -m unittest discover -s ai_worker -p test_solver.py -v
.\.venv-diagnostic\Scripts\python.exe diagnostics/timeout/verify_fix.py
.\.venv-diagnostic\Scripts\python.exe diagnostics/timeout/http_smoke.py
git diff --check
git log -1 --format='%H %s'
```

Baseline reproduction: `.\.venv-diagnostic\Scripts\python.exe diagnostics/timeout/probe.py`.
Dependencies were installed from `ai_worker/requirements.txt` in the isolated `.venv-diagnostic` environment (Python 3.10.9, OR-Tools 9.8.3296).
Fixed runs use random seed 1 and eight solver workers. Parallel solver timings may vary. The baseline did not explicitly set a seed.

## Evidence

- `results.txt`: original solver; one and ten registrations return SUCCESS with zero rows; 40 registrations stopped after 55 seconds without reaching solver search.
- `regression-results.txt`: 13 regression tests pass, including required rooms, unavailable rooms, room locks, collisions, joint groups, teacher-specific blocking, lunch, and daily limits.
- `fixed-results.txt`: fixed solver returns 1, 10, and 40 required rows, all independently validated. The 40-registration case builds in 5.663 seconds and completes in 22.206 seconds; 10 registrations build in 1.690 seconds.
- `http-results.txt` and `http-server.txt`: local HTTP smoke checks and server output.

These are local measurements, not a guarantee of latency on hosted hardware.

## Step 4: actual CSV archive

Command:

```powershell
.\.venv-diagnostic\Scripts\python.exe diagnostics/timeout/real_data_check.py 'C:\Users\IT-Coding-01\Downloads\CSV-20261110T081449Z-1-001.zip'
```

Archive SHA-256: `eb13af31a67f03cff0595de06e4dc4a5cbd948f0076baf67fc2d5cc1137c2cf3`.
Counts: 18 teachers, 22 rooms, 8 groups, 41 subjects, 50 teaching assignments, 65 registrations, 60 timeslots. The handoff mentioned 48 teaching assignments, so this archive may differ from its earlier input.

Used the real backend CSV parser and payload builder with current defaults: 30-second search limit, no extra rules, jointMode=none, maxPeriodsPerDay=10, roomTypeMatch=false. Worker seed 1, eight search workers. No rules were relaxed for this run.

Result: SUCCESS, 237 lesson rows, 44.177 seconds for the worker function including output construction. Reported model build: 14.376 seconds; search: 28.716 seconds. Independent checks for required hours, valid IDs, teacher eligibility, teacher/room/group collisions, lunch, and daily limits pass. Backend checks C01–C08 pass.

The full backend validator still reports C09 room type failures (89), C10 leader meeting conflict (1), C12 activity-time failures (18), and C13 joint-class failures (38); C11 homeroom is unresolved. C14–C18 are inactive. The current payload defaults and worker do not enforce all rules checked by that validator. The candidate is therefore NOT approved for submission. This step diagnosed that discrepancy; it did not change the user's rule policy.

44.177 seconds leaves little margin under the 50-second backend timeout and does not establish hosted reliability. Further performance work is warranted before deployment.

`real-data-run.txt` records the console summary. Full local worker output, validator details, summary, and `candidate-not-approved.csv` are in the ignored `real-data-local/` directory to avoid committing user timetable data.

## Step 5: smaller equivalent room model

Each teaching event now has one integer room variable whose domain contains its allowed real rooms and a unique negative inactive value. An active event must select a real room; an inactive event must select its own inactive value. AllDifferent per timeslot prevents two active events from selecting the same room while allowing any number of inactive candidates. Joint groups still share one event and its room. Non-joint events reuse the assignment Boolean as their occupancy indicator. These changes preserve the scheduling choices enforced in Step 4.

Same archive, backend defaults, seed 1, eight search workers, 30-second search limit:

| Measurement | Step 4 | Step 5 |
| --- | ---: | ---: |
| Worker function elapsed | 44.177 s | 18.552 s |
| Model build | 14.376 s | 0.895 s |
| Search | 28.716 s | 17.547 s |
| Model variables | 209,990 | 9,130 |
| Model constraints | 116,815 | 10,665 |
| Required lesson rows returned | 237 | 237 |

These are single local measurements, not hosted benchmarks. All independent current-model checks and backend checks C01–C08 pass. C09, C10, C12, and C13 still fail; C11 remains unresolved. Exact violation counts differ because the solver selected a different valid solution under the enforced model. This candidate is still not approved for submission.

`step5-real-data-run.txt` records the run. The ignored `real-data-local/` files now contain Step 5 output; `step4-summary.json` preserves the earlier summary. `solver_step4_snapshot.py` preserves the pre-optimization code for reproducibility.

Validation: 15 regression tests pass, including inactive candidates sharing scarce rooms and intersecting room-type/room-lock restrictions. The actual local FastAPI endpoint passes success and infeasible smoke cases. Logs: `step5-regression-results.txt`, `step5-http-results.txt`. Commands are the same as Step 4 and the regression/HTTP commands above. No backend timeout, rule policy, frontend, deployed service, or GitHub branch was changed in this step.

## Step 6: leader meetings and approved pairs

C10 now blocks Leader roles on Tuesday period 8. User then confirmed pair-only shared classes: G1/G2 for 30000-1501, 30000-1202, 30000-2004; G3/G4 for 30000-1201, 30000-1404, 30000-2002, with G5 separate. Singleton G7 may study alone.

The backend now supplies the approved pair map, persists resolved constraints with the schedule, and validates exact pair membership. The worker enforces shared teacher/time/room for each pair and independent resource occupancy for unpaired groups. UI C13 display text reflects this policy. No frontend dependencies are installed, so a frontend build was not run for this text-only change.

Latest run: 237 rows in 17.045 seconds (build 1.680 s, search 15.204 s), seed 1, 30-second search limit, eight workers. C01–C08, C10, C13 pass. C09 fails with 90 violations, C12 fails with 18, C11 unresolved; candidate remains unapproved. See `pairs-real-data-run.txt`. 20 Python regression tests and 6 Node policy/validator tests pass (`pairs-regression-results.txt`, `pairs-backend-results.txt`). Node command: `node --test backend/src/lib/jointClasses.test.js`. No push or deployment has occurred.

Current continuation instructions and confirmed decisions are in the repository-root `HANDOFF.md`.
