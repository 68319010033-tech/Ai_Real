from ortools.sat.python import cp_model

def solve_timetable(data):
    model = cp_model.CpModel()
    
    teachers = data.get("teachers", [])
    rooms = data.get("rooms", [])
    groups = data.get("student_groups", [])
    subjects = data.get("subjects", [])
    registers = data.get("registers", [])
    timeslots = data.get("timeslots", []) # รวม 50 คาบ (5 วัน x 10 คาบ)
    
    # 1. Decision Variables: x[g, s, t, r, slot] = 1 ถ้า กลุ่ม g, วิชา s, ครู t, ห้อง r จัดใน slot นั้น
    x = {}
    for reg in registers:
        g = reg["group_id"]
        s = reg["subject_id"]
        t = reg["teacher_id"]
        
        # ค้นหาห้องที่เหมาะสมเบื้องต้น
        sub_info = next((item for item in subjects if item["subject_id"] == s), {})
        is_lab = sub_info.get("practice_hours", 0) > 0
        
        for r_info in rooms:
            r = r_info["room_id"]
            # C09: วิชาทฤษฎีล้วนใช้ห้อง Theory, ปฏิบัติห้ามใช้ห้อง Theory
            if not is_lab and r_info.get("room_type") != "Theory":
                continue
            if is_lab and r_info.get("room_type") == "Theory":
                continue
                
            for slot in timeslots:
                slot_id = slot["timeslot_id"]
                
                # C02: ห้ามจัดเรียนคาบ 5 (พักกลางวัน)
                if slot.get("period") == 5:
                    continue
                    
                # C10: ครู Leader ประชุมวันอังคาร คาบ 8 ( slot เช่น Day 2, Period 8 )
                t_info = next((item for item in teachers if item["teacher_id"] == t), {})
                if t_info.get("is_leader") and slot.get("day") == 2 and slot.get("period") == 8:
                    continue
                    
                # C12: กิจกรรมวันพุธ คาบ 8-9 ( Day 3, Period 8-9 )
                if slot.get("day") == 3 and slot.get("period") in [8, 9]:
                    continue

                x[(g, s, t, r, slot_id)] = model.NewBoolVar(f'x_{g}_{s}_{t}_{r}_{slot_id}')

    # 2. Hard Constraints
    
    # C01: จำนวนคาบรวมของวิชาต้องเท่ากับที่กำหนด (theory + practice)
    for reg in registers:
        g, s, t = reg["group_id"], reg["subject_id"], reg["teacher_id"]
        sub_info = next((item for item in subjects if item["subject_id"] == s), {})
        total_hours = sub_info.get("theory_hours", 0) + sub_info.get("practice_hours", 0)
        
        valid_vars = [x[(g, s, t, r, slot["timeslot_id"])] 
                      for r_info in rooms for slot in timeslots 
                      if (g, s, t, r_info["room_id"], slot["timeslot_id"]) in x]
        if valid_vars:
            model.Add(sum(valid_vars) == total_hours)

    # C06: ครู 1 คน สอนได้ไม่เกิน 1 ห้องในแต่ละ timeslot
    for t_info in teachers:
        t = t_info["teacher_id"]
        for slot in timeslots:
            slot_id = slot["timeslot_id"]
            t_vars = [x[k] for k in x if k[2] == t and k[4] == slot_id]
            if t_vars:
                model.Add(sum(t_vars) <= 1)

    # C07: ห้อง 1 ห้อง ใช้เรียนได้ไม่เกิน 1 กลุ่มในแต่ละ timeslot
    for r_info in rooms:
        r = r_info["room_id"]
        for slot in timeslots:
            slot_id = slot["timeslot_id"]
            r_vars = [x[k] for k in x if k[3] == r and k[4] == slot_id]
            if r_vars:
                model.Add(sum(r_vars) <= 1)

    # C08: กลุ่มเรียน 1 กลุ่ม เรียนได้ไม่เกิน 1 วิชาในแต่ละ timeslot
    for g_info in groups:
        g = g_info["group_id"]
        for slot in timeslots:
            slot_id = slot["timeslot_id"]
            g_vars = [x[k] for k in x if k[0] == g and k[4] == slot_id]
            if g_vars:
                model.Add(sum(g_vars) <= 1)

    # 3. Solver Setting & Execution
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60.0 # ตั้งเวลาประมวลผลสูงสุด 60 วินาที
    status = solver.Solve(model)

    output_schedule = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for k, v in x.items():
            if solver.Value(v) == 1:
                output_schedule.append({
                    "group_id": k[0],
                    "subject_id": k[1],
                    "teacher_id": k[2],
                    "room_id": k[3],
                    "timeslot_id": k[4]
                })
        return {"status": "SUCCESS", "schedule": output_schedule}
    else:
        return {"status": "INFEASIBLE", "schedule": []}