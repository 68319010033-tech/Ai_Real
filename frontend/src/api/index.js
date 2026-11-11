import axios from 'axios'
import { mockApi } from './mock'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const http = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? '' })

// รูปแบบ response/error เป็นร่าง ต้องตกลงกับเพื่อนฝั่ง backend
export function getSchedule(id = 'latest') {
  return USE_MOCK ? mockApi.getSchedule() : http.get(`/api/schedules/${id}`).then((r) => r.data)
}

// files = ไฟล์ CSV ที่สร้างจากข้อมูลที่ผู้ใช้ตรวจ/แก้แล้ว (buildCsvFiles)
export function importDataset(files) {
  if (USE_MOCK) return mockApi.importDataset(files)
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  return http.post('/api/datasets/import', form).then((r) => r.data)
}

export function startSolve(body) {
  return USE_MOCK ? mockApi.startSolve(body) : http.post('/api/solve-jobs', body).then((r) => r.data)
}

export function getJob(jobId) {
  return USE_MOCK ? mockApi.getJob(jobId) : http.get(`/api/solve-jobs/${jobId}`).then((r) => r.data)
}

export function cancelJob(jobId) {
  return USE_MOCK ? mockApi.cancelJob(jobId) : http.post(`/api/solve-jobs/${jobId}/cancel`).then((r) => r.data)
}

export function errorMessage(e) {
  return e?.response?.data?.message ?? e?.message ?? 'เกิดข้อผิดพลาด'
}
export async function exportSchedule(format, scheduleId) {
  if (USE_MOCK) return mockApi.exportSchedule(format)
  const r = await http.get(`/api/schedules/${scheduleId}/export`, { params: { format }, responseType: 'blob' })
  return r.data
}
export function getValidation(scheduleId) {
  return USE_MOCK ? mockApi.getValidation() : http.post(`/api/schedules/${scheduleId}/validate`).then((r) => r.data)
}