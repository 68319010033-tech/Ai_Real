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


def _day_key(slot):
    return _day_number(slot.get("day"))


def _normalize_constraints(constraints):
    data = constraints or {}
    return {
        "blockedSlots": list(data.get("blockedSlots") or []),
        "reservedSlots": list(data.get("reservedSlots") or []),
        "roomLocks": list(data.get("roomLocks") or []),
        "maxPeriodsPerDay": int(data.get("maxPeriodsPerDay") or 10),
        "roomTypeMatch": bool(data.get("roomTypeMatch") is True),
    }


def _slot_matches_rule(slot, rule):
    slot_day = int(slot.get("day") or 0)
    slot_period = int(slot.get("period") or 0)
    rule_day = str(rule.get("day") or "").strip()
    if not rule_day:
        return False
    if rule_day.lower() == "mon" and slot_day != 1:
        return False
    if rule_day.lower() == "tue" and slot_day != 2:
        return False
    if rule_day.lower() == "wed" and slot_day != 3:
        return False
    if rule_day.lower() == "thu" and slot_day != 4:
        return False
    if rule_day.lower() == "fri" and slot_day != 5:
        return False
    periods = rule.get("periods")
    if periods == "all":
        return True
    if isinstance(periods, list):
        return slot_period in periods
    return slot_period == periods


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
    constraints = _normalize_constraints(data.get("constraints"))
    model = cp_model.CpModel()

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

    blocked_day_periods = set()
    for rule in constraints.get("blockedSlots") or []:
        if not rule.get("enabled", True):
            continue
        if not rule.get("day"):
            continue
        for slot in timeslots:
            if _slot_matches_rule(slot, rule):
                blocked_day_periods.add((int(slot.get("day") or 0), int(slot.get("period") or 0)))

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

        room_candidates = list(rooms)
        if required_rooms:
            room_candidates = [r for r in rooms if str(r.get("room_id")) in required_rooms]
        if constraints.get("roomTypeMatch"):
            subject_room_type = str(sub.get("room_type") or "").strip().lower()
            if subject_room_type:
                room_candidates = [r for r in room_candidates if _room_type(r) == subject_room_type]
                if not room_candidates:
                    rejection_stats["no_room_after_type_filter"].append({
                        "group_id": g,
                        "subject_id": s,
                        "subject_room_type": subject_room_type,
                        "reason": "no room remains after room type filter",
                    })

        valid_slots = []
        for slot in timeslots:
            slot_id = str(slot.get("timeslot_id"))
            day = _day_number(slot.get("day"))
            period = int(slot.get("period") or 0)
            if period == 5:
                continue
            if day == 0:
                continue
            valid_slots.append({"slot_id": slot_id, "day": day, "period": period})

        if not valid_slots:
            rejection_stats["no_slot_after_day_period_filter"].append({"group_id": g, "subject_id": s, "reason": "no valid timeslots remain after day/period filtering"})

        for tid in allowed_teachers:
            t_info = teacher_by_id.get(tid, {})
            teacher_slot_candidates = []
            for slot in timeslots:
                slot_id = str(slot.get("timeslot_id"))
                day = _day_number(slot.get("day"))
                period = int(slot.get("period") or 0)
                if period == 5:
                    continue
                if day == 0:
                    continue
                if (day, period) in blocked_day_periods and _teacher_matches_blocked(t_info, {"who": "all"}):
                    continue
                for rule in constraints.get("blockedSlots") or []:
                    if not rule.get("enabled", True):
                        continue
                    if _slot_matches_rule(slot, rule) and _teacher_matches_blocked(t_info, rule):
                        continue
                if reserved_by_subject.get(s):
                    allowed = False
                    for rule_info in reserved_by_subject[s]:
                        if str(rule_info["day"]).lower() in {"mon", "tue", "wed", "thu", "fri"}:
                            if day == {
                                "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5,
                            }.get(str(rule_info["day"]).lower()):
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
                var = model.NewBoolVar(f"x_{g}_{s}_{tid}_{slot_id}")
                candidate_vars[key] = var

    if candidate_vars:
        print("VARIABLE_GENERATION_SUMMARY")
        total_created = len(candidate_vars)
        print(f"created_vars={total_created}")
        for key, items in rejection_stats.items():
            print(f"{key}={len(items)}")
            for item in items[:5]:
                print(item)
        print("---")
    else:
        print("VARIABLE_GENERATION_SUMMARY")
        print(f"created_vars=0")
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
            "reason": "no assignment variables created; rejects: " + "; ".join(
                f"{k}={len(v)}" for k, v in rejection_stats.items()
            ),
            "debug": {
                "variable_generation": {k: len(v) for k, v in rejection_stats.items()},
                "examples": {k: v[:5] for k, v in rejection_stats.items() if v},
            },
        }

    print(_summarize_rejections(rejection_stats))

    for reg in registers:
        g = str(reg.get("group_id"))
        s = str(reg.get("subject_id"))
        total_hours = _hours(subject_by_id.get(s, {}))
        vars_for_reg = [var for key, var in candidate_vars.items() if key[0] == g and key[1] == s]
        if vars_for_reg:
            model.Add(sum(vars_for_reg) == total_hours)
        elif total_hours > 0:
            return {"status": "MODEL_INVALID", "solver_status": "MODEL_INVALID", "schedule": [], "runtime_seconds": round(perf_counter() - started, 3), "reason": f"no valid variable set for {g}/{s}"}

    group_ids = [str(g.get("group_id")) for g in groups] or sorted({k[0] for k in candidate_vars})
    for g in group_ids:
        for slot in timeslots:
            slot_id = str(slot.get("timeslot_id"))
            slot_vars = [var for key, var in candidate_vars.items() if key[0] == g and key[3] == slot_id]
            if slot_vars:
                model.Add(sum(slot_vars) <= 1)

    for tid in {str(t.get("teacher_id")) for t in teachers}:
        for slot in timeslots:
            slot_id = str(slot.get("timeslot_id"))
            teacher_vars = [var for key, var in candidate_vars.items() if key[2] == tid and key[3] == slot_id]
            if teacher_vars:
                model.Add(sum(teacher_vars) <= 1)

    for g in group_ids:
        for day in sorted({ _day_number(slot.get("day")) for slot in timeslots if _day_number(slot.get("day")) > 0 }):
            day_vars = [
                var for key, var in candidate_vars.items()
                if key[0] == g and any(str(slot.get("timeslot_id")) == key[3] and _day_number(slot.get("day")) == day for slot in timeslots)
            ]
            max_day = int(constraints.get("maxPeriodsPerDay") or 10)
            if day_vars:
                model.Add(sum(day_vars) <= max_day)

    shared_groups = defaultdict(set)
    for reg in registers:
        sid = str(reg.get("subject_id"))
        if _is_shared(sid):
            shared_groups[sid].add(str(reg.get("group_id")))
    for sid, group_set in shared_groups.items():
        g_list = sorted(group_set)
        if len(g_list) < 2:
            continue
        for slot in timeslots:
            slot_id = str(slot.get("timeslot_id"))
            assigned = [
                var for key, var in candidate_vars.items()
                if key[1] == sid and key[3] == slot_id and key[0] in g_list
            ]
            if not assigned:
                continue
            for idx in range(1, len(g_list)):
                first = [var for key, var in candidate_vars.items() if key[0] == g_list[0] and key[1] == sid and key[3] == slot_id]
                current = [var for key, var in candidate_vars.items() if key[0] == g_list[idx] and key[1] == sid and key[3] == slot_id]
                if first and current:
                    model.Add(sum(first) == sum(current))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(5.0, min(120.0, time_limit))
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)
    elapsed = perf_counter() - started

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        schedule = []
        for key, var in candidate_vars.items():
            if solver.Value(var):
                schedule.append({
                    "group_id": key[0],
                    "subject_id": key[1],
                    "teacher_id": key[2],
                    "timeslot_id": key[3],
                    "room_id": "",
                })
        return {
            "status": "SUCCESS",
            "solver_status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
            "schedule": schedule,
            "runtime_seconds": round(elapsed, 3),
            "logs": [{"level": "info", "stage": "solve", "message": f"solver status={status} elapsed={elapsed:.3f}s"}],
            "variables": len(candidate_vars),
        }

    if status == cp_model.UNKNOWN:
        return {"status": "UNKNOWN", "solver_status": "UNKNOWN", "schedule": [], "runtime_seconds": round(elapsed, 3), "reason": "time limit reached", "variables": len(candidate_vars)}

    return {"status": "INFEASIBLE", "solver_status": "INFEASIBLE", "schedule": [], "runtime_seconds": round(elapsed, 3), "reason": "base constraints conflict", "variables": len(candidate_vars)}