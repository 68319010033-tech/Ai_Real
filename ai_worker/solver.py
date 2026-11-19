import os
from room_matching import room_unions, match_rooms
from collections import defaultdict
from time import perf_counter
from ortools.sat.python import cp_model
from runtime_config import search_workers, configure_solver


def _as_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _period_number(value):
    try:
        number = float(value)
        return int(number) if number.is_integer() else 0
    except (TypeError, ValueError, OverflowError):
        return 0


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


def _theory_practice(subject):
    theory = _as_int(subject.get("theory") if subject.get("theory") is not None else subject.get("theory_hours"), 0)
    practice = _as_int(subject.get("practice") if subject.get("practice") is not None else subject.get("practice_hours"), 0)
    return theory, practice


def _hours(subject):
    theory, practice = _theory_practice(subject)
    return theory + practice


def _is_activity_slot(day, period):
    """C12: activity subjects live in Wednesday periods 8-9 only."""
    return day == 3 and period in (8, 9)


def _is_activity(subject):
    text = f"{subject.get('subject_id', '')} {subject.get('subject_name', '')}".lower()
    sid = str(subject.get("subject_id", "")).upper()
    return "activity" in text or "กิจกรรม" in text or sid.startswith("ACT")


def _is_shared(subject_id):
    sid = str(subject_id)
    return sid.startswith("20000") or sid.startswith("30000")


def _room_type(room):
    return str(room.get("room_type") or "").strip().lower()


def _room_ok_for_subject(room, subject):
    explicit = str(subject.get('room_type') or '').strip().lower()
    kind = _room_type(room)
    if explicit:
        return kind == explicit
    practice = _as_int(subject.get('practice', subject.get('practice_hours')), 0)
    theory = _as_int(subject.get('theory', subject.get('theory_hours')), 0)
    return kind != 'theory' if practice > 0 else (not kind or kind == 'theory' or theory <= 0)


def _normalize_constraints(constraints):
    data = constraints or {}
    return {
        "blockedSlots": list(data.get("blockedSlots") or []),
        "reservedSlots": list(data.get("reservedSlots") or []),
        "roomLocks": list(data.get("roomLocks") or []),
        "maxPeriodsPerDay": int(data.get("maxPeriodsPerDay") or 10),
        # คาบสุดท้ายที่อนุญาต (hard) ค่าเริ่มต้น 11 = ห้ามเรียนคาบ 12; ตั้ง 0 = ไม่จำกัด
        "maxPeriod": _as_int(data.get("maxPeriod"), _as_int(os.getenv("AI_MAX_PERIOD"), 11)),
        # วิชาเดียวกันในวันเดียวกันต้องเรียนต่อเนื่องเป็นช่วงเดียว (hard) วิชาข้ามวันได้
        "consecutiveSameSubject": data.get("consecutiveSameSubject") is not False,
        # พยายามให้วิชาเดียวกันเรียนติดกันเป็นก้อนน้อยที่สุด (soft)
        "minimizeSubjectBlocks": bool(data.get("minimizeSubjectBlocks", os.getenv("AI_MINIMIZE_BLOCKS", "1") != "0")),
        "roomTypeMatch": data.get("enforceRoomType", data.get("roomTypeMatch", True)) is not False,
        "enforceActivitySlots": data.get("enforceActivitySlots") is not False,
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
    result = _dispatch_solve(data)
    result.setdefault('logs', [])
    result.setdefault('stats', {'variables':0, 'constraints':0, 'conflicts':0, 'branches':0,
                                'buildTimeSec':0, 'solveTimeSec':0, 'objective':None})
    result['stats']['wallTimeSec'] = round(perf_counter() - started, 3)
    return result


def _dispatch_solve(data):
    if os.getenv('AI_TEACHER_PREASSIGN', '0') != '1':
        return _solve_timetable(data)
    from teacher_assignment import propose_teachers
    started = perf_counter()
    proposal = propose_teachers(data)
    if proposal:
        trial = dict(data, time_limit_seconds=min(10, float(data.get('time_limit_seconds', 60)) / 3))
        result = _solve_timetable(trial, proposal)
        if result['status'] == 'SUCCESS':
            result['stats']['teacherPreassignment'] = True
            return result
    remaining = float(data.get('time_limit_seconds', 60)) - (perf_counter() - started)
    if remaining <= 0:
        return {'status':'UNKNOWN', 'solver_status':'UNKNOWN', 'schedule':[],
                'reason':'Time limit reached before full-model teacher fallback; not proof of infeasibility'}
    result = _solve_timetable(dict(data, time_limit_seconds=remaining))
    result.setdefault('stats', {})['teacherFallback'] = True
    return result


def _solve_timetable(data, teacher_assignments=None):
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
            allowed = [r for r in allowed if _room_ok_for_subject(r, sub)]
        room_options_by_subject[sid] = allowed

    unions = room_unions([{str(r['room_id']) for r in options} for options in room_options_by_subject.values()])
    matching_rooms = os.getenv('AI_ROOM_MODEL', 'matching') != 'classic' and unions is not None
    event_domains = {}
    events_by_slot = defaultdict(list)

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
    registration_teachers = defaultdict(lambda: defaultdict(list))
    registration_periods = defaultdict(lambda: defaultdict(list))
    assumption_labels = {}
    group_slots = defaultdict(list)
    group_days = defaultdict(list)
    slot_days = {str(slot.get("timeslot_id")): _day_number(slot.get("day")) for slot in timeslots}
    slot_periods = {str(slot.get("timeslot_id")): _period_number(slot.get("period")) for slot in timeslots}
    rejection_stats = defaultdict(list)

    for reg in registers:
        g = str(reg.get("group_id"))
        s = str(reg.get("subject_id"))
        sub = subject_by_id.get(s, {})
        allowed_teachers = teachers_for_subject.get(s) or ([str(reg["teacher_id"])] if reg.get("teacher_id") else [])
        reg_teacher = str(reg.get("teacher_id") or "")
        if reg_teacher and reg_teacher in allowed_teachers:
            allowed_teachers = [reg_teacher]
        if teacher_assignments:
            allowed_teachers = [t for t in allowed_teachers if t == teacher_assignments.get((g, s))]
        if 'C19' in data.get('special_rules', []) and ('homeroom' in str(sub.get('subject_name', '')).lower() or 'โฮมรูม' in str(sub.get('subject_name', ''))):
            group = next((row for row in groups if str(row.get('group_id')) == g), {})
            advisor = str(group.get('advisor_id') or '')
            if not advisor or advisor not in teacher_by_id:
                return {'status':'MODEL_INVALID','solver_status':'MODEL_INVALID','schedule':[],
                        'reason':f'C19 requires an explicit valid advisor_id for group {g}'}
            allowed_teachers = [advisor] if advisor in allowed_teachers else []
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
            period = _period_number(slot.get("period"))
            if not 1 <= period <= 12 or period == 5 or day == 0:
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
                period = _period_number(slot.get("period"))
                if not 1 <= period <= 12 or period == 5 or day == 0:
                    continue
                if constraints["maxPeriod"] and period > constraints["maxPeriod"]:
                    continue
                if constraints["enforceActivitySlots"] and _is_activity(sub) != (day == 3 and period in (8, 9)):
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
                var = model.NewBoolVar(f"x_{g}_{s}_{tid}_{slot_id}" if os.getenv("AI_DEBUG_NAMES") == "1" else "")
                candidate_vars[key] = var
                registration_vars[(g, s)].append(var)
                registration_teachers[(g, s)][tid].append(var)
                registration_periods[(g, s, slot_days[slot_id])][slot_periods[slot_id]].append(var)
                group_slots[(g, slot_id)].append(var)
                group_days[(g, slot_days[slot_id])].append(var)

                # Only explicitly joint lessons may share a teacher and room.
                event_group = group_joint.get((s, g), g)
                busy_key = (event_group, tid, s, slot_id)
                assignment_events[key] = busy_key
                if busy_key not in busy_vars:
                    busy_vars[busy_key] = (
                        model.NewBoolVar(f"busy_{busy_key}" if os.getenv("AI_DEBUG_NAMES") == "1" else "") if isinstance(event_group, tuple) else var
                    )
                    teacher_slots[(tid, slot_id)].append(busy_vars[busy_key])
                    allowed_rooms = {room_numbers[str(room.get("room_id"))]
                                     for room in room_options_by_subject.get(s, rooms)}
                    event_domains[busy_key] = allowed_rooms
                    events_by_slot[slot_id].append(busy_key)
                    if not matching_rooms:
                        # Inactive events get distinct negative sentinels. Active
                        # events choose one real room; AllDifferent prevents overlap.
                        inactive_room = -(len(event_rooms) + 1)
                        room_var = model.NewIntVarFromDomain(
                            cp_model.Domain.FromValues(sorted(allowed_rooms | {inactive_room})),
                            f"event_room_{busy_key}" if os.getenv("AI_DEBUG_NAMES") == "1" else "",
                        )
                        model.Add(room_var == inactive_room).OnlyEnforceIf(busy_vars[busy_key].Not())
                        model.Add(room_var != inactive_room).OnlyEnforceIf(busy_vars[busy_key])
                        event_rooms[busy_key] = room_var
                        room_slots[slot_id].append(room_var)
                event_assignments[busy_key].append(var)

    if not candidate_vars:
        return {"status": "INFEASIBLE", "solver_status": "INFEASIBLE", "schedule": [],
                "reason": "No eligible teacher/time assignments remain after mandatory and selected rules (C25: periods 1-12; C02: no period 5).",
                "infeasibleRules": [{"ruleId":"C01", "message":key, "count":len(items)} for key,items in rejection_stats.items()]}

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
            assumption = model.NewBoolVar('')
            model.AddAssumption(assumption)
            assumption_labels[assumption.Index()] = {"ruleId":"C01", "groupId":g, "subjectId":s,
                "message":f"Required hours for {g}/{s} conflict with teacher/room/time availability or other registrations"}
            model.Add(sum(vars_for_reg) == total_hours).OnlyEnforceIf(assumption)
            selectors = []
            for tid, choices in registration_teachers[(g, s)].items():
                selected = model.NewBoolVar('')
                selectors.append(selected)
                model.Add(sum(choices) == total_hours * selected)
            model.Add(sum(selectors) <= 1)
        elif total_hours > 0:
            return {"status": "INFEASIBLE", "solver_status": "INFEASIBLE", "schedule": [], "runtime_seconds": round(perf_counter() - started, 3), "reason": f"No eligible teacher/time assignments for {g}/{s} after mandatory and selected rules", "infeasibleRules":[{"ruleId":"C01","groupId":g,"subjectId":s}]}

    # วิชาเดียวกันของกลุ่มเดียวกัน: ภายในวันเดียวต้องต่อเนื่องเป็นช่วงเดียว (นับ "จุดเริ่มช่วง" ไม่เกิน 1 ต่อวัน)
    # คาบพักเที่ยง (5) ไม่มีตัวแปร จึงตัดช่วงให้อัตโนมัติ (วิชาเดียวกันคร่อมพักเที่ยงไม่ได้)
    block_starts = []
    if constraints["consecutiveSameSubject"] or constraints["minimizeSubjectBlocks"]:
        slot_period = {str(sl.get("timeslot_id")): int(sl.get("period") or 0) for sl in timeslots}
        lits_by_gs_slot = defaultdict(list)
        for (g, s, _tid, slot_id), var in candidate_vars.items():
            lits_by_gs_slot[(g, s, slot_id)].append(var)
        periods_by_gs_day = defaultdict(dict)
        for (g, s, slot_id) in lits_by_gs_slot:
            periods_by_gs_day[(g, s, slot_days[slot_id])][slot_period[slot_id]] = slot_id
        consec_literal = None
        if constraints["consecutiveSameSubject"]:
            consec_literal = model.NewBoolVar('')
            model.AddAssumption(consec_literal)
            assumption_labels[consec_literal.Index()] = {"ruleId": "CONSEC",
                "message": "Same-subject lessons on one day must be consecutive (conflicts with teacher/room/time availability)"}
        for (g, s, _day), periods in periods_by_gs_day.items():
            if _hours(subject_by_id.get(s, {})) <= 1:
                continue
            occupied = {}
            for period, slot_id in periods.items():
                lits = lits_by_gs_slot[(g, s, slot_id)]
                if len(lits) == 1:
                    occupied[period] = lits[0]
                else:
                    flag = model.NewBoolVar('')
                    model.Add(flag == sum(lits))
                    occupied[period] = flag
            starts = []
            for period in sorted(occupied):
                start = model.NewBoolVar('')
                prev = occupied.get(period - 1)
                if prev is None:
                    model.Add(start >= occupied[period])
                else:
                    model.Add(start >= occupied[period] - prev)
                starts.append(start)
            if consec_literal is not None and len(starts) > 1:
                model.Add(sum(starts) <= 1).OnlyEnforceIf(consec_literal)
            block_starts.extend(starts)
        del lits_by_gs_slot, periods_by_gs_day
    has_objective = bool(block_starts) and constraints["minimizeSubjectBlocks"]
    if has_objective:
        model.Minimize(sum(block_starts))

    for slot_vars in group_slots.values():
        model.Add(sum(slot_vars) <= 1)
    for day_vars in group_days.values():
        model.Add(sum(day_vars) <= constraints["maxPeriodsPerDay"])

    # C24: at most one 0->1 transition per group/subject/day. Missing periods
    # (including lunch) remain zero, so a block cannot bridge an unavailable slot.
    # C25 prunes periods after 12. Exact weekly hours therefore place any overflow
    # on another eligible day, where C24 independently requires a consecutive block.
    consecutive_rule = model.NewBoolVar('')
    model.AddAssumption(consecutive_rule)
    assumption_labels[consecutive_rule.Index()] = {
        'ruleId': 'C24',
        'message': 'Each group must study a subject in one consecutive block per day; breaks cannot be bridged.'}
    for (g, sid, day), periods in registration_periods.items():
        if _hours(subject_by_id.get(sid, {})) <= 1:
            continue
        occupied = {}
        starts = []
        for period in sorted(periods):
            choices = periods[period]
            if len(choices) == 1:
                occupied[period] = choices[0]
            else:
                occupied[period] = model.NewBoolVar('')
                model.Add(occupied[period] == sum(choices))
            start = model.NewBoolVar('')
            model.Add(start >= occupied[period] - occupied.get(period - 1, 0))
            starts.append(start)
        model.Add(sum(starts) <= 1).OnlyEnforceIf(consecutive_rule)

    for event_key, busy_var in busy_vars.items():
        event_group, tid, sid, slot_id = event_key
        if isinstance(event_group, tuple):
            for g in joint_sets[(sid, event_group)]:
                model.Add(candidate_vars.get((g, sid, tid, slot_id), 0) == busy_var)

    if matching_rooms:
        numbered_unions = [{room_numbers[r] for r in union} for union in unions]
        for events in events_by_slot.values():
            for union in numbered_unions:
                constrained = [busy_vars[e] for e in events if event_domains[e] <= union]
                if constrained:
                    model.Add(sum(constrained) <= len(union))

    for choices in room_slots.values():
        model.AddAllDifferent(choices)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.01, min(120.0, time_limit))
    solver.parameters.num_search_workers = search_workers()
    solver.parameters.random_seed = _as_int(data.get("seed"), 1)
    profile = configure_solver(solver.parameters)
    import gc
    del event_assignments, registration_vars, registration_teachers, registration_periods, group_slots, group_days, teacher_slots
    gc.collect()
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
        "searchWorkers": solver.parameters.num_search_workers,
        "profile": profile,
        "objective": round(solver.ObjectiveValue(), 2) if has_objective and status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
    }
    logs = [
        {"level": "info", "stage": "build", "message": f"model built in {build_seconds:.3f}s; variables={stats['variables']} constraints={stats['constraints']}"},
        {"level": "info", "stage": "solve", "message": f"solver status={solver.StatusName(status)} elapsed={elapsed:.3f}s seed={solver.parameters.random_seed}"},
    ]

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        assigned_rooms = {}
        if matching_rooms:
            for events in events_by_slot.values():
                matching = match_rooms({e: event_domains[e] for e in events if solver.Value(busy_vars[e])})
                if matching is None:
                    # Hall constraints make this unreachable; never return an invalid SUCCESS.
                    return {"status": "MODEL_INVALID", "solver_status": "MODEL_INVALID", "schedule": [],
                            "reason": "Room matching invariant failed", "stats": stats, "logs": logs}
                assigned_rooms.update(matching)
        schedule = []
        for key, var in candidate_vars.items():
            if solver.Value(var):
                g, s, tid, slot_id = key
                room_number = assigned_rooms[assignment_events[key]] if matching_rooms else solver.Value(event_rooms[assignment_events[key]])
                rid = room_ids[room_number - 1]
                schedule.append({
                    "group_id": g,
                    "subject_id": s,
                    "teacher_id": tid,
                    "timeslot_id": slot_id,
                    "room_id": rid,
                })
        slot_order = {str(sl.get("timeslot_id")): i for i, sl in enumerate(timeslots)}
        schedule.sort(key=lambda r: (r["group_id"], slot_order.get(r["timeslot_id"], 0), r["subject_id"]))
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
    core = [assumption_labels[i] for i in solver.SufficientAssumptionsForInfeasibility() if i in assumption_labels] if status == cp_model.INFEASIBLE else []
    reason = model.Validate() if status == cp_model.MODEL_INVALID else "Required registrations conflict with teacher, room or permitted slot capacity; see infeasibleRules (sufficient conflict set, not necessarily minimal)."
    return {"status": final_status, "solver_status": final_status, "schedule": [], "runtime_seconds": round(elapsed, 3), "reason": reason, "infeasibleRules": core, "variables": len(candidate_vars), "logs": logs, "stats": stats}
