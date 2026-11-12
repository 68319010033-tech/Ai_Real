import csv, json, os, sys
sys.path.insert(0, os.path.join(os.getcwd(), 'ai_worker'))
from solver import solve_timetable

folder = r'c:\Users\ACER\Downloads\cl'
files = ['teacher.csv', 'room.csv', 'student_group.csv', 'subject.csv', 'teach.csv', 'register.csv', 'timeslot.csv']

def read_csv(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

data = {}
for name in files:
    data[name.replace('.csv', '')] = read_csv(os.path.join(folder, name))

payload = {
    'teachers': data['teacher'],
    'rooms': data['room'],
    'student_groups': data['student_group'],
    'subjects': data['subject'],
    'teaches': data['teach'],
    'registers': data['register'],
    'timeslots': data['timeslot'],
    'constraints': {
        'blockedSlots': [],
        'reservedSlots': [],
        'roomLocks': [],
        'maxPeriodsPerDay': 10,
        'roomTypeMatch': False,
    },
    'time_limit_seconds': 60,
}

result = solve_timetable(payload)
print(json.dumps(result, ensure_ascii=False, indent=2))
