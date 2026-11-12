# Ai_Real continuation handoff

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
