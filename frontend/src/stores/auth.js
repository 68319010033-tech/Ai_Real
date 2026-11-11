import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loginRequest, registerRequest, forgotPasswordRequest } from '../api'

const KEY = 'auth-user'
const load = () => {
  try {
    const user = JSON.parse(sessionStorage.getItem(KEY))
    if (!user?.email || !user?.token) return null
    return user
  } catch {
    return null
  }
}
const save = (u) => {
  try {
    u ? sessionStorage.setItem(KEY, JSON.stringify(u)) : sessionStorage.removeItem(KEY)
  } catch { /* ไม่เป็นไร */ }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(load())
  const isLoggedIn = computed(() => !!user.value?.token)

  function setSession(data) {
    user.value = { email: data.email, uid: data.uid, token: data.token }
    save(user.value)
  }

  async function login(email, password) {
    const data = await loginRequest(email, password)
    if (!data?.token) throw new Error(data?.error || 'เข้าสู่ระบบไม่สำเร็จ')
    setSession(data)
  }

  async function register(email, password) {
    const data = await registerRequest(email, password)
    if (!data?.token) throw new Error(data?.error || 'สมัครสมาชิกไม่สำเร็จ')
    setSession(data)
  }

  async function forgotPassword(email) {
    await forgotPasswordRequest(email)
  }

  function logout() {
    user.value = null
    save(null)
  }

  return { user, isLoggedIn, login, register, forgotPassword, logout }
})
