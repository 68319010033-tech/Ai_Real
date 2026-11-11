<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (!/^\S+@\S+\.\S+$/.test(email.value)) { error.value = 'รูปแบบอีเมลไม่ถูกต้อง'; return }
  if (password.value.length < 8) { error.value = 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'; return }
  if (password.value !== confirm.value) { error.value = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'; return }
  loading.value = true
  try {
    await auth.register(email.value, password.value)
    router.push('/upload')
  } catch (e) {
    error.value = 'สมัครสมาชิกไม่สำเร็จ ลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-canvas p-4">
    <form class="w-full max-w-sm rounded-lg border border-line bg-white p-6" @submit.prevent="submit" novalidate>
      <h1 class="text-2xl font-bold">สมัครสมาชิก</h1>

      <label class="mt-5 block text-sm font-medium" for="email">อีเมล</label>
      <input id="email" v-model="email" type="email" autocomplete="email"
        class="mt-1 w-full rounded border border-line px-3 py-2" />

      <label class="mt-4 block text-sm font-medium" for="password">รหัสผ่าน (อย่างน้อย 8 ตัว)</label>
      <input id="password" v-model="password" type="password" autocomplete="new-password"
        class="mt-1 w-full rounded border border-line px-3 py-2" />

      <label class="mt-4 block text-sm font-medium" for="confirm">ยืนยันรหัสผ่าน</label>
      <input id="confirm" v-model="confirm" type="password" autocomplete="new-password"
        class="mt-1 w-full rounded border border-line px-3 py-2" />

      <p v-if="error" class="mt-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800" role="alert">{{ error }}</p>

      <button type="submit" class="btn mt-5 w-full" :disabled="loading">
        {{ loading ? 'กำลังสมัคร...' : 'สมัครสมาชิก' }}
      </button>

      <p class="mt-4 text-sm">
        มีบัญชีอยู่แล้ว? <RouterLink to="/login" class="text-accent">เข้าสู่ระบบ</RouterLink>
      </p>
    </form>
  </main>
</template>