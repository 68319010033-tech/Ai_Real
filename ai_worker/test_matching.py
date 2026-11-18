import itertools
import os
import unittest
from unittest.mock import patch
from room_matching import room_unions, match_rooms
from solver import solve_timetable
from test_solver import fixture, verify_schedule

class MatchingTests(unittest.TestCase):
    def test_hall_and_matching_agree_exhaustively(self):
        domains=[set(i for i in range(3) if mask & (1<<i)) for mask in range(8)]
        for choices in itertools.product(domains,repeat=3):
            hall=all(sum(d <= union for d in choices)<=len(union) for union in room_unions(choices))
            matching=match_rooms(dict(enumerate(choices)))
            self.assertEqual(hall,matching is not None)
            if matching is not None:
                self.assertEqual(len(set(matching.values())),3)
                self.assertTrue(all(room in choices[e] for e,room in matching.items()))

    def test_complex_domains_fall_back(self):
        self.assertIsNone(room_unions([{i} for i in range(10)]))

    def test_classic_and_matching_agree(self):
        for count,slots,rooms in [(1,2,1),(3,1,2),(3,3,1),(2,1,0)]:
            data=fixture(count,slots,rooms)
            with patch.dict(os.environ,{'AI_ROOM_MODEL':'classic'}): a=solve_timetable(data)
            with patch.dict(os.environ,{'AI_ROOM_MODEL':'matching'}): b=solve_timetable(data)
            self.assertEqual(a['status'],b['status'])

    def test_no_split_teacher_false_success(self):
        data=fixture(slots=2)
        data['subjects'][0]['theory']=2
        data['teachers'].append({'teacher_id':'T1'})
        data['teaches'].append({'teacher_id':'T1','subject_id':'S0'})
        data['constraints']={'blockedSlots':[
            {'day':'Mon','periods':[1],'who':['T0']},
            {'day':'Mon','periods':[2],'who':['T1']}]}
        result=solve_timetable(data)
        self.assertEqual(result['status'],'INFEASIBLE')
        self.assertTrue(result['infeasibleRules'])

    def test_activity_only_wednesday_and_other_subjects_excluded(self):
        data=fixture(slots=2)
        data['subjects'][0]['subject_name']='Activity'
        data['timeslots'][1].update(day=3,period=8)
        self.assertEqual(solve_timetable(data)['schedule'][0]['timeslot_id'],'L1')
        data['subjects'][0]['subject_name']='Ordinary'
        self.assertEqual(solve_timetable(data)['schedule'][0]['timeslot_id'],'L0')

    def test_advisor_requires_explicit_id(self):
        data=fixture()
        data['subjects'][0]['subject_name']='Homeroom'
        data['special_rules']=['C19']
        self.assertEqual(solve_timetable(data)['status'],'MODEL_INVALID')
        data['student_groups'][0]['advisor_id']='T0'
        verify_schedule(data,solve_timetable(data))

    def test_teacher_proposal_fallback_keeps_feasible_case(self):
        data=fixture(count=2,slots=2,rooms=2)
        data['teachers']=[{'teacher_id':'T0'},{'teacher_id':'T1'}]
        data['teaches']=[{'subject_id':'S0','teacher_id':'T0'}, {'subject_id':'S0','teacher_id':'T1'},
                         {'subject_id':'S1','teacher_id':'T0'}, {'subject_id':'S1','teacher_id':'T1'}]
        # Greedy assigns S0 to T0, which is unavailable. Full model assigns T1.
        data['constraints']={'blockedSlots':[{'day':'Mon','periods':'all','who':['T0']}]}
        with patch.dict(os.environ,{'AI_TEACHER_PREASSIGN':'1'}):
            result=solve_timetable(data)
        verify_schedule(data,result)
        self.assertTrue(result['stats']['teacherFallback'])

    def test_seed_determinism(self):
        data=fixture(3,5,2)
        self.assertEqual(solve_timetable(data)['schedule'],solve_timetable(data)['schedule'])

if __name__ == '__main__': unittest.main()
