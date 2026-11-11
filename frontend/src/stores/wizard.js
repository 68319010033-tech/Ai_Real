import { defineStore } from 'pinia'

export const STEPS = [
  { n: 1, path: '/upload', title: 'อัปโหลดไฟล์', hint: 'เลือกไฟล์ CSV หรือ XLSX' },
  { n: 2, path: '/review', title: 'ตรวจรายละเอียดไฟล์', hint: 'ดูจำนวนแถวและข้อผิดพลาด' },
  { n: 3, path: '/generate', title: 'ให้ AI จัดตาราง', hint: 'สั่งคำนวณตารางสอน' },
  { n: 4, path: '/timetable', title: 'ดูตาราง', hint: 'ดูตามกลุ่ม ครู ห้อง' },
  { n: 5, path: '/export', title: 'ส่งออกไฟล์', hint: 'CSV, Excel, PDF' },
]

export const useWizardStore = defineStore('wizard', {
  state: () => ({ importResult: null, reviewed: false, scheduleId: null, viewed: false }),
  getters: {
    isDone: (s) => (n) => [!!s.importResult, s.reviewed, !!s.scheduleId, s.viewed, false][n - 1],
    isUnlocked() {
      return (n) => n === 1 || this.isDone(n - 1)
    },
    blockingErrors: (s) => (s.importResult?.errors ?? []).filter((e) => e.severity === 'error'),
  },
  actions: {
    setImport(result) {
      this.importResult = result
      this.reviewed = false
      this.scheduleId = null
      this.viewed = false
    },
    markReviewed() { this.reviewed = true },
    setSchedule(id) { this.scheduleId = id; this.viewed = false },
    markViewed() { this.viewed = true },
  },
})