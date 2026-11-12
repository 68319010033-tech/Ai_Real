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

function callWithFallback(method, candidates, config = {}) {
  const attempts = [...candidates]
  const run = (url) => method(url, config)

  return run(attempts.shift()).catch((error) => {
    if (error?.response?.status !== 404 || !attempts.length) throw error
    return run(attempts.shift())
  })
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

  return callWithFallback(
    (url) => http.get(url).then((r) => r.data),
    [`/api/schedule/schedules/${id}`, `/api/schedules/${id}`, `/api/schedule/${id}`],
  )
}

export function importDataset(files) {
  if (USE_MOCK) return mockApi.importDataset(files)

  const form = new FormData()
  files.forEach((f) => form.append('files', f))

  return callWithFallback(
    (url) => http.post(url, form).then((r) => r.data),
    ['/api/schedule/datasets/import', '/api/datasets/import', '/api/schedule/import'],
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
    ['/api/schedule/solve-jobs', '/api/solve-jobs', '/api/schedule/generate'],
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
    [`/api/schedule/solve-jobs/${jobId}`, `/api/solve-jobs/${jobId}`, `/api/schedule/jobs/${jobId}`],
  )
}

export function cancelJob(jobId) {
  if (USE_MOCK) return mockApi.cancelJob(jobId)

  return callWithFallback(
    (url) => http.post(url).then((r) => r.data),
    [`/api/schedule/solve-jobs/${jobId}/cancel`, `/api/solve-jobs/${jobId}/cancel`, `/api/schedule/jobs/${jobId}/cancel`],
  )
}

export function errorMessage(e) {
  return e?.response?.data?.message ?? e?.response?.data?.error ?? e?.message ?? 'เกิดข้อผิดพลาด'
}

export async function exportSchedule(format, scheduleId) {
  if (USE_MOCK) return mockApi.exportSchedule(format)

  const r = await callWithFallback(
    (url) => http.get(url, { params: { format }, responseType: 'blob' }),
    [`/api/schedule/schedules/${scheduleId}/export`, `/api/schedules/${scheduleId}/export`, `/api/schedule/${scheduleId}/export`],
  )
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

  return callWithFallback(
    (url) => http.post(url).then((r) => r.data),
    [`/api/schedule/schedules/${scheduleId}/validate`, `/api/schedules/${scheduleId}/validate`, `/api/schedule/${scheduleId}/validate`],
  )
}