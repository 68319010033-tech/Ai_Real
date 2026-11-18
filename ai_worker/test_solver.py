"""Synthetic regression cases; these are not the user's timetable dataset."""
import unittest
from collections import Counter, defaultdict

from solver import solve_timetable


def fixture(count=1, slots=1, rooms=1):
    return {
        'teachers': [{'teacher_id': f'T{i}'} for i in range(count)],
        'rooms': [{'room_id': f'R{i}'} for i in range(rooms)],
        'student_groups': [{'group_id': f'G{i}'} for i in range(count)],
        'subjects': [{'subject_id': f'S{i}', 'theory': 1, 'practice': 0} for i in range(count)],
        'teaches': [{'teacher_id': f'T{i}', 'subject_id': f'S{i}'} for i in range(count)],
        'registers': [{'group_id': f'G{i}', 'subject_id': f'S{i}'} for i in range(count)],
        'timeslots': [{'timeslot_id': f'L{i}', 'day': i // 11 + 1,
                       'period': i % 11 + (1 if i % 11 < 4 else 2)} for i in range(slots)],
        'time_limit_seconds': 5,
        'seed': 1,
    }


def verify_schedule(data, result):
    """Check output rows independently of the CP-SAT variables."""
    assert result['status'] == 'SUCCESS', result
    rows = result['schedule']
    subjects = {s['subject_id']: s for s in data['subjects']}
    expected = {(r['group_id'], r['subject_id']): subjects[r['subject_id']]['theory'] + subjects[r['subject_id']]['practice'] for r in data['registers']}
    assert Counter((r['group_id'], r['subject_id']) for r in rows) == expected
    room_ids = {r['room_id'] for r in data['rooms']}
    slot_ids = {s['timeslot_id'] for s in data['timeslots'] if s['period'] != 5}
    eligible = {(t['subject_id'], t['teacher_id']) for t in data['teaches']}
    assert all(r['room_id'] in room_ids and r['timeslot_id'] in slot_ids and (r['subject_id'], r['teacher_id']) in eligible for r in rows)
    assert max(Counter((r['group_id'], r['timeslot_id']) for r in rows).values()) == 1
    policy = data.get('constraints', {})
    together = policy.get('jointMode') == 'together'
    for resource in ('teacher_id', 'room_id'):
        occupied = defaultdict(list)
        for row in rows:
            occupied[(row[resource], row['timeslot_id'])].append(row)
        for simultaneous in occupied.values():
            if len(simultaneous) > 1:
                assert together or policy.get('jointMode') == 'pairs'
                assert simultaneous[0]['subject_id'].startswith(('20000', '30000'))
                assert len({(r['subject_id'], r['teacher_id'], r['room_id']) for r in simultaneous}) == 1
                if policy.get('jointMode') == 'pairs':
                    present = sorted(r['group_id'] for r in simultaneous)
                    assert present in [sorted(p) for p in policy.get('jointPairs', {}).get(simultaneous[0]['subject_id'], [])]
    for sid, pairs in policy.get('jointPairs', {}).items():
        for first, second in pairs:
            def meetings(group):
                return {(r['timeslot_id'], r['teacher_id'], r['room_id']) for r in rows if r['subject_id'] == sid and r['group_id'] == group}
            assert meetings(first) == meetings(second)


class SolverRegressionTests(unittest.TestCase):
    def solve_valid(self, data):
        result = solve_timetable(data)
        verify_schedule(data, result)
        return result

    def test_required_lesson_has_exactly_one_room(self):
        self.solve_valid(fixture(rooms=3))

    def test_inactive_candidates_do_not_occupy_rooms(self):
        self.solve_valid(fixture(count=3, slots=4, rooms=1))

    def test_room_domain_preserves_type_and_lock_intersection(self):
        data = fixture(rooms=3)
        data['subjects'][0]['room_type'] = 'lab'
        for index, room in enumerate(data['rooms']):
            room['room_type'] = 'lab' if index > 0 else 'classroom'
        data['constraints'] = {'roomTypeMatch': True,
                              'roomLocks': [{'subject_id': 'S0', 'room_id': 'R2'}]}
        self.assertEqual(self.solve_valid(data)['schedule'][0]['room_id'], 'R2')
        data['constraints']['roomLocks'][0]['room_id'] = 'R0'
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_missing_rooms_is_infeasible(self):
        self.assertEqual(solve_timetable(fixture(rooms=0))['status'], 'INFEASIBLE')

    def test_two_lessons_cannot_use_one_room_at_once(self):
        self.assertEqual(solve_timetable(fixture(count=2))['status'], 'INFEASIBLE')

    def test_different_rooms_allow_simultaneous_lessons(self):
        self.solve_valid(fixture(count=2, rooms=2))

    def test_teacher_cannot_teach_two_subjects_at_once(self):
        data = fixture(count=2, rooms=2)
        data['teaches'][1]['teacher_id'] = 'T0'
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_room_lock_is_respected(self):
        data = fixture(rooms=2)
        data['constraints'] = {'roomLocks': [{'subject_id': 'S0', 'room_id': 'R1'}]}
        self.assertEqual(self.solve_valid(data)['schedule'][0]['room_id'], 'R1')
        data['constraints']['roomLocks'][0]['room_id'] = 'missing'
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def shared(self, mode='together', groups=2):
        data = fixture(count=groups)
        data['subjects'] = [{'subject_id': '30000-test', 'theory': 1, 'practice': 0}]
        data['teaches'] = [{'teacher_id': 'T0', 'subject_id': '30000-test'}]
        for reg in data['registers']:
            reg['subject_id'] = '30000-test'
        data['constraints'] = {'jointMode': mode}
        return data

    def test_joint_lesson_counts_once_for_teacher_and_room(self):
        self.solve_valid(self.shared(groups=3))

    def test_pair_and_third_group_study_separately(self):
        data = self.shared(mode='pairs', groups=3)
        data['constraints']['jointPairs'] = {'30000-test': [['G0', 'G1']]}
        data['timeslots'] = fixture(slots=2)['timeslots']
        self.solve_valid(data)
        data['timeslots'].pop()
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_pairs_allow_singleton(self):
        data = self.shared(mode='pairs', groups=1)
        self.solve_valid(data)

    def test_invalid_pair_configuration_is_rejected(self):
        data = self.shared(mode='pairs', groups=3)
        for pairs in ([['G0', 'G1', 'G2']], [['G0', 'G0']], [['G0', 'missing']], [['G0', 'G1'], ['G1', 'G2']]):
            data['constraints']['jointPairs'] = {'30000-test': pairs}
            self.assertEqual(solve_timetable(data)['status'], 'MODEL_INVALID')

    def test_joint_lesson_cannot_collide_with_another_subject(self):
        data = self.shared()
        extra = fixture(count=3)
        for table in ('subjects', 'teaches', 'registers', 'student_groups'):
            data[table].append(extra[table][2])
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_separate_groups_cannot_share_teacher(self):
        data = self.shared(mode='none')
        data['rooms'].append({'room_id': 'R1'})
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_same_subject_different_teachers_cannot_share_room(self):
        data = self.shared(mode='none')
        data['teaches'].append({'teacher_id': 'T1', 'subject_id': '30000-test'})
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')
        data['rooms'].append({'room_id': 'R1'})
        self.solve_valid(data)

    def test_block_applies_only_to_selected_teacher(self):
        data = fixture()
        data['timeslots'][0]['day'] = 'Mon'
        data['constraints'] = {'blockedSlots': [{'day': 'Mon', 'periods': [1], 'who': ['OTHER']}]}
        self.solve_valid(data)
        data['constraints']['blockedSlots'][0]['who'] = ['T0']
        self.assertNotEqual(solve_timetable(data)['status'], 'SUCCESS')

    def test_leader_meeting_is_unavailable_but_other_slots_remain(self):
        data = fixture(slots=2)
        data['teachers'][0]['role'] = 'Leader'
        data['timeslots'] = [
            {'timeslot_id': 'L0', 'day': 'Tue', 'period': 8},
            {'timeslot_id': 'L1', 'day': 'Tue', 'period': 9},
        ]
        result = self.solve_valid(data)
        self.assertEqual(result['schedule'][0]['timeslot_id'], 'L1')
        data['timeslots'].pop()
        self.assertNotEqual(solve_timetable(data)['status'], 'SUCCESS')

    def test_nonleader_can_teach_during_leader_meeting(self):
        data = fixture()
        data['teachers'][0]['role'] = 'Teacher'
        data['timeslots'][0].update(day=2, period=8)
        self.solve_valid(data)

    def test_lunch_and_daily_limit_stay_enforced(self):
        data = fixture(slots=2)
        data['subjects'][0]['theory'] = 2
        data['constraints'] = {'maxPeriodsPerDay': 1}
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')
        data['constraints']['maxPeriodsPerDay'] = 10
        data['timeslots'][1]['period'] = 5
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_group_cannot_attend_two_lessons_at_once(self):
        data = fixture(count=2, rooms=2)
        data['registers'][1]['group_id'] = 'G0'
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')


if __name__ == '__main__':
    unittest.main()
