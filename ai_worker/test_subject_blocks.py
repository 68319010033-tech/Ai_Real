import unittest
from solver import solve_timetable
from test_solver import fixture, verify_schedule


class SubjectBlockTests(unittest.TestCase):
    def data(self, slots, hours=2):
        data = fixture(slots=1)
        data['subjects'][0]['theory'] = hours
        data['timeslots'] = [{'timeslot_id': f'S{i}', 'day': day, 'period': period}
                             for i, (day, period) in enumerate(slots)]
        return data

    def valid(self, data):
        result = solve_timetable(data)
        verify_schedule(data, result)
        return result

    def test_consecutive_block_can_end_at_period_12(self):
        result = self.valid(self.data([(1, 11), (1, 12), (1, 13)]))
        self.assertEqual({row['timeslot_id'] for row in result['schedule']}, {'S0', 'S1'})

    def test_overflow_after_12_moves_to_another_day(self):
        data = self.data([(1, 11), (1, 12), (1, 13), (1, 14), (2, 1), (2, 2)], 4)
        result = self.valid(data)
        self.assertEqual({row['timeslot_id'] for row in result['schedule']},
                         {'S0', 'S1', 'S4', 'S5'})

    def test_overflow_can_skip_an_unavailable_day(self):
        data = self.data([(1, 11), (1, 12), (1, 13), (2, 1), (3, 1)], 3)
        data['constraints'] = {'blockedSlots': [{'day': 'Tue', 'periods': [1], 'who': 'all'}]}
        result = self.valid(data)
        self.assertEqual({row['timeslot_id'] for row in result['schedule']},
                         {'S0', 'S1', 'S4'})

    def test_overflow_without_another_eligible_day_is_infeasible(self):
        data = self.data([(1, 11), (1, 12), (1, 13)], 3)
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_whole_block_is_preferred_over_spreading_across_days(self):
        data = self.data([(1, 12), (2, 1), (2, 2), (2, 3)], 3)
        result = self.valid(data)
        self.assertEqual({row['timeslot_id'] for row in result['schedule']}, {'S1', 'S2', 'S3'})
        self.assertTrue(result['stats']['blockOptimalityProven'])
        self.assertEqual(result['stats']['objective'], 1)

    def test_necessary_split_uses_fewest_days(self):
        data = self.data([(day, period) for day in (1, 2, 3) for period in (1, 2)], 4)
        result = self.valid(data)
        slots = {s['timeslot_id']: s for s in data['timeslots']}
        days = {slots[row['timeslot_id']]['day'] for row in result['schedule']}
        self.assertEqual(len(days), 2)
        self.assertEqual(result['stats']['objective'], 2)
        self.assertEqual(result['stats']['objectiveBound'], 2)

    def test_subject_over_12_hours_can_be_cut_into_daily_blocks(self):
        data = self.data([(day, period) for day in (1, 2) for period in range(6, 14)], 14)
        result = self.valid(data)
        slots = {s['timeslot_id']: s for s in data['timeslots']}
        self.assertEqual(len(result['schedule']), 14)
        self.assertTrue(all(slots[row['timeslot_id']]['period'] <= 12 for row in result['schedule']))
        self.assertEqual(result['stats']['objective'], 2)

    def test_period_13_never_used_even_if_client_attempts_override(self):
        data = self.data([(1, 13)], 1)
        data['constraints'] = {'lastPeriod': 99}
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_out_of_range_periods_cannot_fill_required_hours(self):
        for invalid in (0, -1, 13, 12.5):
            self.assertEqual(solve_timetable(self.data([(1, 12), (1, invalid)]))['status'], 'INFEASIBLE')

    def test_gap_is_infeasible_and_reports_consecutive_rule(self):
        data = self.data([(1, 1), (1, 3)])
        data['constraints'] = {'consecutiveSubjectPerDay': False}
        result = solve_timetable(data)
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertIn('C24', [rule['ruleId'] for rule in result['infeasibleRules']])

    def test_lunch_is_a_gap(self):
        self.assertEqual(solve_timetable(self.data([(1, 4), (1, 5), (1, 6)]))['status'], 'INFEASIBLE')

    def test_blocked_middle_period_cannot_be_bridged(self):
        data = self.data([(1, 1), (1, 2), (1, 3)])
        data['constraints'] = {'blockedSlots': [{'day': 'Mon', 'periods': [2], 'who': 'all'}]}
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_multiple_days_and_unordered_csv_are_allowed(self):
        self.valid(self.data([(2, 12), (1, 2), (2, 11), (1, 1)], 4))

    def test_other_subject_cannot_split_a_block(self):
        data = self.data([(1, 1), (1, 2), (1, 3)])
        data['subjects'].append({'subject_id': 'S1', 'theory': 1, 'practice': 0})
        data['registers'].append({'group_id': 'G0', 'subject_id': 'S1'})
        data['teaches'].append({'teacher_id': 'T0', 'subject_id': 'S1'})
        data['constraints'] = {'reservedSlots': [{'subjects': ['S1'], 'day': 'Mon', 'periods': [2]}]}
        self.assertEqual(solve_timetable(data)['status'], 'INFEASIBLE')

    def test_joint_pair_keeps_same_consecutive_periods(self):
        data = self.data([(1, 3), (1, 1), (1, 2)])
        data['subjects'][0]['subject_id'] = '30000-block'
        data['teaches'][0]['subject_id'] = '30000-block'
        data['registers'] = [{'group_id': group, 'subject_id': '30000-block'} for group in ['G0', 'G1']]
        data['student_groups'].append({'group_id': 'G1'})
        data['constraints'] = {'jointMode': 'pairs', 'jointPairs': {'30000-block': [['G0', 'G1']]}}
        self.valid(data)


if __name__ == '__main__':
    unittest.main()
