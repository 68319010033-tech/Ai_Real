from collections import defaultdict
from time import perf_counter
from ortools.sat.python import cp_model


def _as_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _day_number(value):
    if value is None:
        return 0
    s = str(value).strip()
    if not s:
        return 0
    mapping = {
        'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5,
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5,
        'จันทร์': 1, 'อังคาร': 2, 'พุธ': 3, 'พฤหัสบดี': 4, 'ศุกร์': 5,
    }
    low = s.lower()
    if low in mapping:
        return mapping[low]
    return _as_int(s, 0)


def _hours(subject):
    theory = _as_int(subject.get("theory") if subject.get("theory") is not None else subject.get("theory_hours"), 0)
    practice = _as_int(subject.get("practice") if subject.get("practice") is not None else subject.get("practice_hours"), 0)
    return theory + practice


def _is_activity(subject):
    text = f"{subject.get('subject_id', '')} {subject.get('subject_name', '')}".lower()
    sid = str(subject.get("subject_id", "")).upper()
    return "activity" in text or "กิจกรรม" in text or sid.startswith("ACT")


def _is_shared(subject_id):
    sid = str(subject_id)
    return sid.startswith("20000") or sid.startswith("30000")


def _room_type(room):
    return str(room.get("room_type") or "").strip().lower()


def _normalize_constraints(constraints):
    data = constraints or {}
    return {
        "blockedSlots": list(data.get("blockedSlots") or []),
        "reservedSlots": list(data.get("reservedSlots") or []),
        "roomLocks": list(data.get("roomLocks") or []),
        "maxPeriodsPerDay": int(data.get("maxPeriodsPerDay") or 10),
        "roomTypeMatch": bool(data.get("roomTypeMatch") is True),
        "jointMode": str(data.get("jointMode") or data.get("joint_mode") or "none").strip().lower(),
    }


def _slot_matches_rule(slot, rule):
    slot_day = _day_number(slot.get("day"))
    slot_period = int(slot.get("period") or 0)
    rule_day = str(rule.get("day") or "").strip()
    if not rule_day:
        return False
    if _day_number(rule_day) != slot_day:
        return False
    periods = rule.get("periods")
    if periods == "all":
        return True
    if isinstance(periods, list):
        return slot_period in [int(p) for p in periods]
    if isinstance(periods, (int, float, str)):
        return slot_period == int(periods)
    return False


def _teacher_matches_blocked(teacher, rule):
    who = rule.get("who")
    if who == "all":
        return True
    if isinstance(who, dict):
        role = str(who.get("role") or "").lower()
        teacher_role = str(teacher.get("role") or "").lower()
        return role in teacher_role or teacher_role in role
    if isinstance(who, list):
        return str(teacher.get("teacher_id") or "") in {str(v) for v in who}
    return False


def _summarize_rejections(stats):
    lines = []
    for key, items in stats.items():
        if key == 'created_vars':
            continue
        if not isinstance(items, list):
            continue
        lines.append(f"{key}: total={len(items)} examples={items[:5]}")
    return "\n".join(lines)


def solve_timetable(data):
    started = perf_counter()
    raw_constraints = data.get("constraints") or {}
    constraints = _normalize_constraints(raw_constraints)
    model = cp_model.CpModel()

    joint_mode = str(data.get("jointMode") or data.get("joint_mode") or constraints.get("jointMode") or "none").strip().lower()

    teachers = data.get("teachers", [])
    rooms = data.get("rooms", [])
    groups = data.get("student_groups", [])
    subjects = data.get("subjects", [])
    teaches = data.get("teaches") or data.get("teach") or []
    registers = data.get("registers", [])
    timeslots = data.get("timeslots", [])
    room_locks = data.get("room_locks") or constraints.get("roomLocks") or []
    time_limit = float(data.get("time_limit_seconds") or 60)

    subject_by_id = {str(s.get("subject_id")): s for s in subjects}
    teacher_by_id = {str(t.get("teacher_id")): t for t in teachers}

    joint_sets = {}
    group_joint = {}
    registered_groups = defaultdict(set)
    for reg in registers:
        registered_groups[str(reg.get("subject_id"))].add(str(reg.get("group_id")))
    if joint_mode == "pairs":
        pair_config = raw_constraints.get("jointPairs") or {}
        try:
            if not isinstance(pair_config, dict):
                raise ValueError("jointPairs must be an object keyed by subject ID")
            for sid, pairs in pair_config.items():
                if not _is_shared(sid) or not isinstance(pairs, list):
                    raise ValueError(f"Invalid joint pair subject: {sid}")
                for pair in pairs:
                    if not isinstance(pair, list) or len(pair) != 2 or len(set(pair)) != 2:
                        raise ValueError(f"Each pair for {sid} must contain two distinct group IDs")
                    members = tuple(sorted(str(g) for g in pair))
                    if any(g not in registered_groups[sid] or (sid, g) in group_joint for g in members):
                        raise ValueError(f"Pair for {sid} contains unregistered or repeated groups")
                    joint_sets[(sid, members)] = members
                    for g in members:
                        group_joint[(sid, g)] = members
        except (ValueError, TypeError) as error:
            return {"status": "MODEL_INVALID", "solver_status": "MODEL_INVALID", "schedule": [], "reason": str(error)}
    elif joint_mode == "together":
        for sid, members in registered_groups.items():
            if _is_shared(sid):
                members = tuple(sorted(members))
                joint_sets[(sid, members)] = members
                for g in members:
                    group_joint[(sid, g)] = members

    teachers_for_subject = defaultdict(list)
    for row in teaches:
        sid = str(row.get("subject_id"))
        tid = str(row.get("teacher_id"))
        if sid and tid and tid not in teachers_for_subject[sid]:
            teachers_for_subject[sid].append(tid)

    locked_rooms = defaultdict(set)
    for lock in room_locks:
        sid = str(lock.get("subject_id") or lock.get("subjectId") or "")
        rid = str(lock.get("room_id") or lock.get("roomId") or "")
        if sid and rid:
            locked_rooms[sid].add(rid)

    room_options_by_subject = defaultdict(list)
    for sid, sub in subject_by_id.items():
        allowed = list(rooms)
        if locked_rooms.get(sid):
            allowed = [r for r in rooms if str(r.get("room_id")) in locked_rooms[sid]]
        if constraints.get("roomTypeMatch"):
            subject_room_type = str(sub.get("room_type") or "").strip().lower()
            if subject_room_type:
                allowed = [r for r in allowed if _room_type(r) == subject_room_type]
        room_options_by_subject[sid] = allowed

    reserved_by_subject = defaultdict(list)
    for rule in constraints.get("reservedSlots") or []:
        if not rule.get("enabled", True):
            continue
        for sid in rule.get("subjects") or []:
            reserved_by_subject[str(sid)].append({
                "day": str(rule.get("day") or ""),
                "periods": rule.get("periods") or [],
            })

    candidate_vars = {}
    busy_vars = {}
    assignment_events = {}
    event_assignments = defaultdict(list)
    event_rooms = {}
    room_ids = list(dict.fromkeys(str(room.get("room_id")) for room in rooms))
    room_numbers = {rid: index + 1 for index, rid in enumerate(room_ids)}
    teacher_slots = defaultdict(list)
    room_slots = defaultdict(list)
    registration_vars = defaultdict(list)
    group_slots = defaultdict(list)
    group_days = defaultdict(list)
    slot_days = {str(slot.get("timeslot_id")): _day_number(slot.get("day")) for slot in timeslots}
    rejection_stats = defaultdict(list)

    for reg in registers:
        g = str(reg.get("group_id"))
        s = str(reg.get("subject_id"))
        sub = subject_by_id.get(s, {})
        allowed_teachers = teachers_for_subject.get(s) or ([str(reg["teacher_id"])] if reg.get("teacher_id") else [])
        if not allowed_teachers:
            rejection_stats["no_teacher_in_teach"].append({"group_id": g, "subject_id": s, "reason": "no teacher in teach"})
            continue

        total_hours = _hours(sub)
        if total_hours <= 0:
            rejection_stats["zero_total_hours"].append({"group_id": g, "subject_id": s, "total_hours": total_hours})
            continue

        required_rooms = locked_rooms.get(s)
        if required_rooms is not None and not required_rooms:
            rejection_stats["no_room_after_lock_filter"].append({"group_id": g, "subject_id": s, "reason": "room lock set empty"})

        valid_slots = []
        for slot in timeslots:
            day = _day_number(slot.get("day"))
            period = int(slot.get("period") or 0)
            if period == 5 or day == 0:
                continue
            valid_slots.append({"slot_id": str(slot.get("timeslot_id")), "day": day, "period": period})
        if not valid_slots:
            rejection_stats["no_slot_after_day_period_filter"].append({"group_id": g, "subject_id": s, "reason": "no valid timeslots remain after day/period filtering"})

        for tid in allowed_teachers:
            t_info = teacher_by_id.get(tid, {})
            teacher_slot_candidates = []
            for slot in timeslots:
                slot_id = str(slot.get("timeslot_id"))
                day = _day_number(slot.get("day"))
                period = int(slot.get("period") or 0)
                if period == 5 or day == 0:
                    continue
                # C10 is shown as mandatory in the UI and checked by the
                # backend validator. Match its case-insensitive role predicate.
                if "leader" in str(t_info.get("role") or "").lower() and day == 2 and period == 8:
                    continue
                blocked_here = False
                for rule in constraints.get("blockedSlots") or []:
                    if not rule.get("enabled", True):
                        continue
                    if _slot_matches_rule(slot, rule) and _teacher_matches_blocked(t_info, rule):
                        blocked_here = True
                        break
                if blocked_here:
                    continue
                if reserved_by_subject.get(s):
                    allowed = False
                    for rule_info in reserved_by_subject[s]:
                        day_name = str(rule_info["day"]).lower()
                        if day_name in {"mon", "tue", "wed", "thu", "fri"}:
                            if day == {"mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5}.get(day_name):
                                periods = rule_info["periods"]
                                if periods == "all" or period in periods:
                                    allowed = True
                    if not allowed and any(rule_info.get("day") for rule_info in reserved_by_subject[s]):
                        continue
                teacher_slot_candidates.append(slot_id)

            if not teacher_slot_candidates:
                rejection_stats["no_slot_after_teacher_filter"].append({
                    "group_id": g,
                    "subject_id": s,
                    "teacher_id": tid,
                    "reason": "teacher has no valid slot after day/period and blocked/reserved filtering",
                })
                continue

            for slot_id in teacher_slot_candidates:
                key = (g, s, tid, slot_id)
                if key in candidate_vars:
                    continue
                var = model.NewBoolVar(f"x_{g}_{s}_{tid}_{slot_id}")
                candidate_vars[key] = var
                registration_vars[(g, s)].append(var)
                group_slots[(g, slot_id)].append(var)
                group_days[(g, slot_days[slot_id])].append(var)

                # Only explicitly joint lessons may share a teacher and room.
                event_group = group_joint.get((s, g), g)
                busy_key = (event_group, tid, s, slot_id)
                assignment_events[key] = busy_key
                if busy_key not in busy_vars:
                    busy_vars[busy_key] = (
                        model.NewBoolVar(f"busy_{busy_key}") if isinstance(event_group, tuple) else var
                    )
                    teacher_slots[(tid, slot_id)].append(busy_vars[busy_key])
                    allowed_rooms = {room_numbers[str(room.get("room_id"))]
                                     for room in room_options_by_subject.get(s, rooms)}
                    # Inactive events get distinct negative sentinels. Active
                    # events choose one real room; AllDifferent prevents overlap.
                    inactive_room = -(len(event_rooms) + 1)
                    room_var = model.NewIntVarFromDomain(
                        cp_model.Domain.FromValues(sorted(allowed_rooms | {inactive_room})),
                        f"event_room_{busy_key}",
                    )
                    model.Add(room_var == inactive_room).OnlyEnforceIf(busy_vars[busy_key].Not())
                    model.Add(room_var != inactive_room).OnlyEnforceIf(busy_vars[busy_key])
                    event_rooms[busy_key] = room_var
                    room_slots[slot_id].append(room_var)
                event_assignments[busy_key].append(var)

    if not candidate_vars:
        print("VARIABLE_GENERATION_SUMMARY")
        print("created_vars=0")
        for key, items in rejection_stats.items():
            print(f"{key}={len(items)}")
            for item in items[:5]:
                print(item)
        print("---")
        return {
            "status": "MODEL_INVALID",
            "solver_status": "MODEL_INVALID",
            "schedule": [],
            "runtime_seconds": round(perf_counter() - started, 3),
            "reason": "no assignment variables created; rejects: " + "; ".join(f"{k}={len(v)}" for k, v in rejection_stats.items()),
            "debug": {
                "variable_generation": {k: len(v) for k, v in rejection_stats.items()},
                "examples": {k: v[:5] for k, v in rejection_stats.items() if v},
            },
        }

    for busy_key, busy_var in busy_vars.items():
        if isinstance(busy_key[0], tuple):
            model.AddMaxEquality(busy_var, event_assignments[busy_key])

    for busy_for_slot in teacher_slots.values():
        model.Add(sum(busy_for_slot) <= 1)

    for reg in registers:
        g = str(reg.get("group_id"))
        s = str(reg.get("subject_id"))
        total_hours = _hours(subject_by_id.get(s, {}))
        vars_for_reg = registration_vars[(g, s)]
        if vars_for_reg:
            model.Add(sum(vars_for_reg) == total_hours)
        elif total_hours > 0:
            return {"status": "MODEL_INVALID", "solver_status": "MODEL_INVALID", "schedule": [], "runtime_seconds": round(perf_counter() - started, 3), "reason": f"no valid variable set for {g}/{s}"}

    for slot_vars in group_slots.values():
        model.Add(sum(slot_vars) <= 1)
    for day_vars in group_days.values():
        model.Add(sum(day_vars) <= constraints["maxPeriodsPerDay"])

    for event_key, busy_var in busy_vars.items():
        event_group, tid, sid, slot_id = event_key
        if isinstance(event_group, tuple):
            for g in joint_sets[(sid, event_group)]:
                model.Add(candidate_vars.get((g, sid, tid, slot_id), 0) == busy_var)

    for choices in room_slots.values():
        model.AddAllDifferent(choices)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(5.0, min(120.0, time_limit))
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = _as_int(data.get("seed"), 1)
    build_seconds = perf_counter() - started
    status = solver.Solve(model)
    elapsed = perf_counter() - started
    stats = {
        "variables": len(model.Proto().variables),
        "constraints": len(model.Proto().constraints),
        "conflicts": solver.NumConflicts(),
        "branches": solver.NumBranches(),
        "wallTimeSec": round(elapsed, 3),
        "buildTimeSec": round(build_seconds, 3),
        "solveTimeSec": round(solver.WallTime(), 3),
        "objective": None,
    }
    logs = [
        {"level": "info", "stage": "build", "message": f"model built in {build_seconds:.3f}s; variables={stats['variables']} constraints={stats['constraints']}"},
        {"level": "info", "stage": "solve", "message": f"solver status={solver.StatusName(status)} elapsed={elapsed:.3f}s seed={solver.parameters.random_seed}"},
    ]

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        schedule = []
        for key, var in candidate_vars.items():
            if solver.Value(var):
                g, s, tid, slot_id = key
                room_number = solver.Value(event_rooms[assignment_events[key]])
                rid = room_ids[room_number - 1]
                schedule.append({
                    "group_id": g,
                    "subject_id": s,
                    "teacher_id": tid,
                    "timeslot_id": slot_id,
                    "room_id": rid,
                })
        return {
            "status": "SUCCESS",
            "solver_status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
            "schedule": schedule,
            "runtime_seconds": round(elapsed, 3),
            "logs": logs,
            "stats": stats,
            "variables": len(candidate_vars),
        }

    if status == cp_model.UNKNOWN:
        return {"status": "UNKNOWN", "solver_status": "UNKNOWN", "schedule": [], "runtime_seconds": round(elapsed, 3), "reason": "time limit reached", "variables": len(candidate_vars), "logs": logs, "stats": stats}

    final_status = "MODEL_INVALID" if status == cp_model.MODEL_INVALID else "INFEASIBLE"
    reason = model.Validate() if status == cp_model.MODEL_INVALID else "No solution satisfies the current model; conflicting rules have not been isolated."
    return {"status": final_status, "solver_status": final_status, "schedule": [], "runtime_seconds": round(elapsed, 3), "reason": reason, "variables": len(candidate_vars), "logs": logs, "stats": stats}
