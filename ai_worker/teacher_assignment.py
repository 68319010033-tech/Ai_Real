"""Optional deterministic balanced teacher proposal; full model remains fallback."""
from collections import defaultdict


def propose_teachers(data):
    subjects = {str(s['subject_id']): s for s in data['subjects']}
    eligible = defaultdict(set)
    teachers = {str(t['teacher_id']) for t in data['teachers']}
    for row in data.get('teaches', []):
        if str(row['teacher_id']) in teachers:
            eligible[str(row['subject_id'])].add(str(row['teacher_id']))
    groups = {str(g['group_id']): g for g in data['student_groups']}
    pairs = data.get('constraints', {}).get('jointPairs', {})
    mode = data.get('constraints', {}).get('jointMode')
    events = {}
    for reg in data['registers']:
        sid, gid = str(reg['subject_id']), str(reg['group_id'])
        members = (gid,)
        if mode == 'pairs':
            members = next((tuple(sorted(p)) for p in pairs.get(sid, []) if gid in p), members)
        elif mode == 'together' and sid.startswith(('20000', '30000')):
            members = tuple(sorted(str(r['group_id']) for r in data['registers'] if str(r['subject_id']) == sid))
        events[(sid, members)] = eligible[sid]
    loads = defaultdict(int)
    assignments = {}
    for (sid, members), options in sorted(events.items(), key=lambda item: (len(item[1]), item[0])):
        sub = subjects.get(sid, {})
        hours = int(float(sub.get('theory', 0))) + int(float(sub.get('practice', 0)))
        if 'C19' in data.get('special_rules', []) and any(word in str(sub.get('subject_name', '')).lower() for word in ('homeroom', 'โฮมรูม')):
            options = options & {str(groups.get(members[0], {}).get('advisor_id', ''))}
        if not options:
            return None
        tid = min(options, key=lambda t: (loads[t], t))
        loads[tid] += hours
        for gid in members:
            assignments[(gid, sid)] = tid
    return assignments
