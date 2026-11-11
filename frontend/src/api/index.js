import axios from 'axios'
import { mockApi } from './mock'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const http = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? '' })

// รูปแบบ response/error เป็นร่าง ต้องตกลงกับเพื่อนฝั่ง backend
export function getSchedule(id = 'latest') {
  return USE_MOCK ? mockApi.getSchedule() : http.get(`/api/schedules/${id}`).then((r) => r.data)
}

export function importDataset(files) {
  if (USE_MOCK) return mockApi.importDataset(files)
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  return http.post('/api/datasets/import', form).then((r) => r.data)
}

export function errorMessage(e) {
  return e?.response?.data?.message ?? e?.message ?? 'เกิดข้อผิดพลาด'
}
