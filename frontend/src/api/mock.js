// ข้อมูลจำลองเพื่อพัฒนา UI เท่านั้น ไม่ใช่ข้อมูลจริงจากกรรมการ
// timeslot_id = (day-1)*12 + period  (ตรงกับ C10: อังคารคาบ 8 = 20, C12: พุธคาบ 8-9 = 32,33)
const delay = (v, ms = 400) => new Promise((r) => setTimeout(() => r(v), ms))

export const mockTimeslots = Array.from({ length: 60 }, (_, i) => ({
  timeslotId: String(i + 1),
  day: Math.floor(i / 12) + 1, // 1=จันทร์ ... 5=ศุกร์
  period: (i % 12) + 1,
}))

export const mockEvents = [
  { eventId: 'e1', groupIds: ['G1'], subjectId: 'S-DEMO-1', subjectName: 'วิชาตัวอย่าง 1', teacherId: 'T01', roomId: 'R0001', timeslotId: '1', component: 'theory' },
  { eventId: 'e2', groupIds: ['G1'], subjectId: 'S-DEMO-1', subjectName: 'วิชาตัวอย่าง 1', teacherId: 'T01', roomId: 'R0002', timeslotId: '2', component: 'practice' },
  { eventId: 'e3', groupIds: ['G3', 'G4'], sharedEventId: 'sh1', subjectId: '30000-DEMO', subjectName: 'วิชาเรียนร่วม (ตัวอย่าง)', teacherId: 'T02', roomId: 'R0001', timeslotId: '14', component: 'theory' },
  { eventId: 'e4', groupIds: ['G1'], subjectId: 'ACT-DEMO', subjectName: 'กิจกรรม (ตัวอย่าง)', teacherId: 'T03', roomId: 'R0003', timeslotId: '32', component: 'theory' },
]

const jobs = {}

export const mockApi = {
  getSchedule: () => delay({ scheduleId: 'demo', datasetVersion: 'demo', solverStatus: 'FEASIBLE', timeslots: mockTimeslots, events: mockEvents }),
  importDataset: (files) =>
    delay({
      datasetVersion: 'demo-1',
      counts: { teacher: 18, room: 22, student_group: 8, subject: 41, teach: 50, register: 65, timeslot: 60 },
      errors: [
        { code: 'SCHEMA_INVALID', file: files[0]?.name ?? 'room.csv', sheet: null, row: 5, column: 'room_id', message: 'ค่าเป็น placeholder (ตัวอย่างจำลอง)' },
      ],
    }, 800),

      startSolve: () => {
    const jobId = 'job-' + Date.now()
    jobs[jobId] = { startedAt: Date.now(), cancelled: false }
    return delay({ jobId }, 200)
  },
  getJob: (jobId) => {
    const j = jobs[jobId]
    const elapsed = (Date.now() - j.startedAt) / 1000
    if (j.cancelled) return delay({ jobId, status: 'cancelled', solverStatus: null })
    if (elapsed < 1) return delay({ jobId, status: 'queued', solverStatus: null }, 100)
    if (elapsed < 5) return delay({ jobId, status: 'running', solverStatus: null }, 100)
    return delay({ jobId, status: 'completed', solverStatus: 'FEASIBLE', scheduleId: 'demo' }, 100)
  },
  cancelJob: (jobId) => {
    jobs[jobId].cancelled = true
    return delay({ jobId }, 100)
  },
}
