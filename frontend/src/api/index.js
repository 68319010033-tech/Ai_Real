import axios from 'axios'
import { mockApi } from './mock'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const http = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? '' })

function callWithFallback(method, candidates, config = {}) {
  const attempts = [...candidates]
  const run = (url) => method(url, config)

  return run(attempts.shift()).catch((error) => {
    if (error?.response?.status !== 404 || !attempts.length) throw error
    return run(attempts.shift())
  })
}

// Backend ปัจจุบันมี route /api/schedule และ /api/auth
// ให้รองรับ route แบบเก่า/ใหม่ เพื่อไม่พังเวลา backend ยังไม่ sync
export function getSchedule(id = 'latest') {
  if (USE_MOCK) return mockApi.getSchedule()

  return callWithFallback(
    (url) => http.get(url).then((r) => r.data),
    [`/api/schedule/${id}`, `/api/schedules/${id}`],
  )
}

// frontend สร้าง CSV 7 ไฟล์จากตารางที่ user แก้แล้ว
// backend ปัจจุบันยังไม่มี /api/datasets/import ให้ปล่อยให้ชัดเจนว่าควรติดตาม route ใหม่
export function importDataset(files) {
  if (USE_MOCK) return mockApi.importDataset(files)

  const form = new FormData()
  files.forEach((f) => form.append('files', f))

  return callWithFallback(
    (url) => http.post(url, form).then((r) => r.data),
    ['/api/datasets/import', '/api/schedule/import'],
  ).catch((error) => {
    if (error?.response?.status === 404) {
      throw new Error('Backend ยังไม่ได้ implement /api/datasets/import หรือ /api/schedule/import')
    }
    throw error
  })
}

export function startSolve(body) {
  if (USE_MOCK) return mockApi.startSolve(body)

  return callWithFallback(
    (url) => http.post(url, body).then((r) => r.data),
    ['/api/solve-jobs', '/api/schedule/generate'],
  ).catch((error) => {
    if (error?.response?.status === 404) {
      throw new Error('Backend ยังไม่ได้ implement solve job endpoint')
    }
    throw error
  })
}

export function getJob(jobId) {
  if (USE_MOCK) return mockApi.getJob(jobId)

  return callWithFallback(
    (url) => http.get(url).then((r) => r.data),
    [`/api/solve-jobs/${jobId}`, `/api/schedule/jobs/${jobId}`],
  )
}

export function cancelJob(jobId) {
  if (USE_MOCK) return mockApi.cancelJob(jobId)

  return callWithFallback(
    (url) => http.post(url).then((r) => r.data),
    [`/api/solve-jobs/${jobId}/cancel`, `/api/schedule/jobs/${jobId}/cancel`],
  )
}

export function errorMessage(e) {
  return e?.response?.data?.message ?? e?.response?.data?.error ?? e?.message ?? 'เกิดข้อผิดพลาด'
}

export async function exportSchedule(format, scheduleId) {
  if (USE_MOCK) return mockApi.exportSchedule(format)

  const r = await callWithFallback(
    (url) => http.get(url, { params: { format }, responseType: 'blob' }),
    [`/api/schedules/${scheduleId}/export`, `/api/schedule/${scheduleId}/export`],
  )
  return r.data
}

export function getValidation(scheduleId) {
  if (USE_MOCK) return mockApi.getValidation()

  return callWithFallback(
    (url) => http.post(url).then((r) => r.data),
    [`/api/schedules/${scheduleId}/validate`, `/api/schedule/${scheduleId}/validate`],
  )
}