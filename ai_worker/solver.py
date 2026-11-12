from collections import defaultdict
from ortools.sat.python import cp_model


def _hours(subject):
    return int(subject.get("theory_hours") or 0) + int(subject.get("practice_hours") or 0)


def _is_activity(subject):
    text = f"{subject.get('subject_id', '')} {subject.get('subject_name', '')}".lower()
    sid = str(subject.get("subject_id", "")).upper()
    return "activity" in text or "กิจกรรม" in text or sid.startswith("ACT")


def _is_shared(subject_id):
    sid = str(subject_id)
    return sid.startswith("20000") or sid.startswith("30000")


def _room_type(room):
    return str(room.get("room_type") or "").strip().lower()


def solve_timetable(data):
    model = cp_model.CpModel()

    teachers = data.get("teachers", [])
    rooms = data.get("rooms", [])
    groups = data.get("student_groups", [])
    subjects = data.get("subjects", [])
    teaches = data.get("teaches") or data.get("teach") or []
    registers = data.get("registers", [])
    timeslots = data.get("timeslots", [])
    room_locks = data.get("room_locks") or []
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
        locked_rooms[str(lock.get("subject_id"))].add(str(lock.get("room_id")))

    x = {}
    for reg in registers:
        g = str(reg.get("group_id"))
        s = str(reg.get("subject_id"))
        sub = subject_by_id.get(s, {})
        allowed_teachers = teachers_for_subject.get(s) or ([str(reg["teacher_id"])] if reg.get("teacher_id") else [])
        if not allowed_teachers:
            continue

        theory_only = int(sub.get("theory_hours") or 0) > 0 and int(sub.get("practice_hours") or 0) == 0
        has_practice = int(sub.get("practice_hours") or 0) > 0
        activity = _is_activity(sub)
        required_rooms = locked_rooms.get(s)

        for t in allowed_teachers:
            t_info = teacher_by_id.get(t, {})
            for r_info in rooms:
                r = str(r_info.get("room_id"))
                rtype = _room_type(r_info)
                if required_rooms and r not in required_rooms:
                    continue
                if theory_only and rtype and rtype != "theory":
                    continue
                if has_practice and rtype == "theory":
                    continue

                for slot in timeslots:
                    slot_id = str(slot.get("timeslot_id"))
                    day = int(slot.get("day") or 0)
                    period = int(slot.get("period") or 0)

                    if period == 5:
                        continue
                    if t_info.get("is_leader") and day == 2 and period == 8:
                        continue
                    activity_slot = day == 3 and period in (8, 9)
                    if activity and not activity_slot:
                        continue
                    if (not activity) and activity_slot:
                        continue

                    x[(g, s, t, r, slot_id)] = model.NewBoolVar(f"x_{g}_{s}_{t}_{r}_{slot_id}")

    if not x:
        return {"status": "INFEASIBLE", "schedule": [], "reason": "no valid assignment variables"}

    for reg in registers:
        g = str(reg.get("group_id"))
        s = str(reg.get("subject_id"))
        total_hours = _hours(subject_by_id.get(s, {}))
        valid_vars = [var for key, var in x.items() if key[0] == g and key[1] == s]
        if valid_vars:
            model.Add(sum(valid_vars) == total_hours)
        elif total_hours > 0:
            return {"status": "INFEASIBLE", "schedule": [], "reason": f"no slots for {g}/{s}"}

    group_ids = [str(g.get("group_id")) for g in groups] or sorted({k[0] for k in x})
    for g in group_ids:
        for slot in timeslots:
            slot_id = str(slot.get("timeslot_id"))
            g_vars = [var for key, var in x.items() if key[0] == g and key[4] == slot_id]
            if g_vars:
                model.Add(sum(g_vars) <= 1)

    def add_unique_class(index):
        by_slot = defaultdict(lambda: defaultdict(list))
        for key, var in x.items():
            _g, s, t, r, slot_id = key
            class_key = (s, t, r) if index == "teacher" else (s, t)
            # รวมหลายกลุ่มเป็น "คาบเดียว" ได้เฉพาะวิชาเรียนร่วม 20000/30000 (C13)
            # วิชาอื่นทุกกลุ่มนับเป็นคาบแยก จึงใช้ครู/ห้องซ้อนเวลากันไม่ได้ (C06, C07)
            if not _is_shared(s):
                class_key = class_key + (_g,)
            owner = t if index == "teacher" else r
            by_slot[(owner, slot_id)][class_key].append(var)
        for (_owner, _slot_id), classes in by_slot.items():
            flags = []
            for vars_in_class in classes.values():
                flag = model.NewBoolVar(f"{index}_{_owner}_{_slot_id}_{len(flags)}")
                model.AddMaxEquality(flag, vars_in_class)
                flags.append(flag)
            if flags:
                model.Add(sum(flags) <= 1)

    add_unique_class("teacher")
    add_unique_class("room")

    days = sorted({int(slot.get("day") or 0) for slot in timeslots})
    for g in group_ids:
        for day in days:
            day_slots = {str(slot.get("timeslot_id")) for slot in timeslots if int(slot.get("day") or 0) == day}
            day_vars = [var for key, var in x.items() if key[0] == g and key[4] in day_slots]
            if day_vars:
                model.Add(sum(day_vars) <= 10)

    shared_groups = defaultdict(set)
    for reg in registers:
        sid = str(reg.get("subject_id"))
        if _is_shared(sid):
            shared_groups[sid].add(str(reg.get("group_id")))
    for sid, group_set in shared_groups.items():
        group_list = list(group_set)
        if len(group_list) < 2:
            continue
        by_class = defaultdict(dict)
        for key, var in x.items():
            g, s, t, r, slot_id = key
            if s != sid:
                continue
            by_class[(t, r, slot_id)][g] = var
        g0 = group_list[0]
        for others in by_class.values():
            if g0 not in others:
                continue
            for g in group_list[1:]:
                if g in others:
                    model.Add(others[g0] == others[g])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(5.0, time_limit)
    status = solver.Solve(model)

    output_schedule = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for key, var in x.items():
            if solver.Value(var) == 1:
                output_schedule.append({
                    "group_id": key[0],
                    "subject_id": key[1],
                    "teacher_id": key[2],
                    "room_id": key[3],
                    "timeslot_id": key[4],
                })
        solver_status = "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
        return {"status": "SUCCESS", "solver_status": solver_status, "schedule": output_schedule}

    if status == cp_model.UNKNOWN:
        return {"status": "UNKNOWN", "solver_status": "UNKNOWN", "schedule": []}
    return {"status": "INFEASIBLE", "solver_status": "INFEASIBLE", "schedule": []}