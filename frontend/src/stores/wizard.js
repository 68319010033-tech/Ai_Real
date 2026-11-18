import { defineStore } from 'pinia'
import { TABLES, validate } from '../lib/parseDataset'

export const STEPS = [
  { n: 1, path: '/upload', title: 'อัปโหลดไฟล์', hint: 'เลือกไฟล์ CSV หรือ XLSX' },
  { n: 2, path: '/review', title: 'ตรวจรายละเอียดไฟล์', hint: 'ดูจำนวนแถวและข้อผิดพลาด' },
  { n: 3, path: '/generate', title: 'ให้ AI จัดตาราง', hint: 'สั่งคำนวณตารางสอน' },
  { n: 4, path: '/timetable', title: 'ดูตาราง', hint: 'ดูตามกลุ่ม ครู ห้อง' },
  { n: 5, path: '/export', title: 'ส่งออกไฟล์', hint: 'CSV, Excel, PDF' },
]

const KEY = 'wizard-state'
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) } catch { return null } }
const clone = (x) => JSON.parse(JSON.stringify(x))

export const useWizardStore = defineStore('wizard', {
  state: () => {
    const saved = load() ?? {}
    return {
      sources: saved.sources ?? [], // ทุก sheet/ไฟล์ที่อ่านได้ {file, sheet, headers, rows, table, orig}
      choice: saved.choice ?? {},   // { subject: 1 } = เลือก sheet ลำดับที่ 2 ของตารางนั้น
           datasetVersion: saved.datasetVersion ?? null,
      reviewed: saved.reviewed ?? false,
      scheduleId: saved.scheduleId ?? null,
      viewed: saved.viewed ?? false,
    }
  },
  getters: {
    candidates: (s) => (name) => s.sources.filter((x) => x.table === name),
    tables() {
      const out = {}
      for (const name of Object.keys(TABLES)) {
        const list = this.candidates(name)
        const t = list[this.choice[name] ?? 0] ?? list[0]
        if (t) out[name] = t
      }
      return out
    },
    importResult() {
      if (!this.sources.length) return null
      const counts = {}
      for (const name of Object.keys(TABLES)) counts[name] = this.tables[name]?.rows.length ?? 0
      return { datasetVersion: 'local', counts, errors: validate(this.tables) }
    },
    isDone() {
      return (n) => [!!this.importResult, this.reviewed, !!this.scheduleId, this.viewed, false][n - 1]
    },
    isUnlocked() {
      return (n) => n === 1 || this.isDone(n - 1)
    },
    blockingErrors() {
      return (this.importResult?.errors ?? []).filter((e) => e.severity === 'error')
    },
  },
  actions: {
    persist() {
      try {
        sessionStorage.setItem(KEY, JSON.stringify({
                    sources: this.sources, choice: this.choice, datasetVersion: this.datasetVersion,
          reviewed: this.reviewed, scheduleId: this.scheduleId, viewed: this.viewed,
        }))
      } catch { /* ข้อมูลใหญ่เกินที่เก็บได้ ไม่เป็นไร แค่รีเฟรชแล้วหาย */ }
    },
    setSources(list) {
      this.sources = list.map((s) => ({ ...s, orig: clone(s.rows) }))
      this.choice = {}
      this.reviewed = false
      this.scheduleId = null
      this.viewed = false
      this.persist()
    },
    // แก้ข้อมูล/เปลี่ยน sheet แล้ว ตารางที่เคยสร้างและการตรวจผลเก่าใช้ไม่ได้
       invalidate() {
      this.datasetVersion = null
      this.reviewed = false
      this.scheduleId = null
      this.viewed = false
    },
    pick(name, i) { this.choice[name] = i; this.invalidate(); this.persist() },
    editCell(row, col, value) { row[col] = value; this.invalidate(); this.persist() },
    isEdited(src) { return JSON.stringify(src.rows) !== JSON.stringify(src.orig) },
    resetSource(src) { src.rows = clone(src.orig); this.invalidate(); this.persist() },
    markReviewed() { this.reviewed = true; this.persist() },
        setDatasetVersion(v) { this.datasetVersion = v; this.persist() },
    setSchedule(id) { this.scheduleId = id; this.viewed = false; this.persist() },
    markViewed() { this.viewed = true; this.persist() },
  },
})