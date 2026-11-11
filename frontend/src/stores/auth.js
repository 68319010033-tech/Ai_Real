import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const KEY = 'auth-user'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) } catch { return null } }
const save = (u) => { try { u ? sessionStorage.setItem(KEY, JSON.stringify(u)) : sessionStorage.removeItem(KEY) } catch { /* ไม่เป็นไร */ } }

// TODO: ฟังก์ชันทั้งหมดในไฟล์นี้เป็นของจำลอง เปลี่ยนเป็น Firebase Auth หรือ API จริงที่ไฟล์นี้ไฟล์เดียว
export const useAuthStore = defineStore('auth', () => {
  const user = ref(load())
  const isLoggedIn = computed(() => !!user.value)

  async function login(email, password) {
    await wait(500)
    user.value = { email }
    save(user.value)
  }
  async function register(email, password) {
    await wait(500)
    user.value = { email }
    save(user.value)
  }
  async function forgotPassword(email) {
    await wait(500)
  }
  function logout() {
    user.value = null
    save(null)
  }

  return { user, isLoggedIn, login, register, forgotPassword, logout }
})