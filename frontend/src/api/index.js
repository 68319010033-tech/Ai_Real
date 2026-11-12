import axios from 'axios'
import { mockApi } from './mock'

const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true'
const AUTH_KEY = 'auth-user'
const http = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? '' })

http.interceptors.request.use((config) => {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY)
    const user = raw ? JSON.parse(raw) : null
    if (user?.token) config.headers.Authorization = `Bearer ${user.token}`
  } catch {
    /* ignore */
  }
  return config
})

// ถ้า endpoint ไม่มีจริง (404) ให้ขึ้นข้อความที่บอกว่าเรียก path ไหน แทนการลอง path สำรองเงียบ ๆ
function notFoundAs(path) {
  return (error) => {
    if (error?.response?.status === 404) {
      throw new Error(`Backend ไม่พบ endpoint ${path} (ตรวจว่า deploy เวอร์ชันล่าสุดแล้ว)`)
    }
    throw error
  }
}

export function loginRequest(email, password) {
  return http.post('/api/auth/login', { email, password }).then((r) => r.data)
}

export function registerRequest(email, password, displayName) {
  return http.post('/api/auth/register', { email, password, displayName }).then((r) => r.data)
}

export function forgotPasswordRequest(email) {
  return http.post('/api/auth/forgot-password', { email }).then((r) => r.data)
}

export function resetPasswordRequest(email, otp, newPassword) {
  return http.post('/api/auth/reset-password', { email, otp, newPassword }).then((r) => r.data)
}

export function getSchedule(id = 'latest') {
  if (USE_MOCK) return mockApi.getSchedule()
  const path = `/api/schedules/${id}`
  return http.get(path).then((r) => r.data).catch(notFoundAs(path))
}

export function importDataset(files) {
  if (USE_MOCK) return mockApi.importDataset(files)

  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const path = '/api/datasets/import'
  return http.post(path, form).then((r) => r.data).catch(notFoundAs(path))
}

export function startSolve(body) {
  if (USE_MOCK) return mockApi.startSolve(body)
  const path = '/api/solve-jobs'
  return http.post(path, body).then((r) => r.data).catch(notFoundAs(path))
}

export function getJob(jobId) {
  if (USE_MOCK) return mockApi.getJob(jobId)
  const path = `/api/solve-jobs/${jobId}`
  return http.get(path).then((r) => r.data).catch(notFoundAs(path))
}

export function cancelJob(jobId) {
  if (USE_MOCK) return mockApi.cancelJob(jobId)
  const path = `/api/solve-jobs/${jobId}/cancel`
  return http.post(path).then((r) => r.data).catch(notFoundAs(path))
}

export function errorMessage(e) {
  return e?.response?.data?.message ?? e?.response?.data?.error ?? e?.message ?? 'เกิดข้อผิดพลาด'
}

export async function exportSchedule(format, scheduleId) {
  if (USE_MOCK) return mockApi.exportSchedule(format)

  const path = `/api/schedules/${scheduleId}/export`
  const r = await http.get(path, { params: { format }, responseType: 'blob' }).catch(notFoundAs(path))
  const type = r.headers?.['content-type'] || ''
  if (type.includes('application/json')) {
    const text = await r.data.text()
    const json = JSON.parse(text)
    throw new Error(json.error || json.message || 'ส่งออกไฟล์ไม่สำเร็จ')
  }
  return r.data
}

export function getValidation(scheduleId) {
  if (USE_MOCK) return mockApi.getValidation()
  const path = `/api/schedules/${scheduleId}/validate`
  return http.post(path).then((r) => r.data).catch(notFoundAs(path))
}