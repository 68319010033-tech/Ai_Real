<script setup>
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (!/^\S+@\S+\.\S+$/.test(email.value)) { error.value = 'รูปแบบอีเมลไม่ถูกต้อง'; return }
  if (!password.value) { error.value = 'กรุณากรอกรหัสผ่าน'; return }
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    router.push(typeof route.query.redirect === 'string' ? route.query.redirect : '/upload')
  } catch (e) {
    error.value = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-canvas p-4">
    <form class="w-full max-w-sm rounded-lg border border-line bg-white p-6" @submit.prevent="submit" novalidate>
      <h1 class="text-2xl font-bold">เข้าสู่ระบบ</h1>
      <p class="mt-1 text-sm text-muted">ระบบจัดตารางสอนอัตโนมัติ</p>

      <label class="mt-5 block text-sm font-medium" for="email">อีเมล</label>
      <input id="email" v-model="email" type="email" autocomplete="email"
        class="mt-1 w-full rounded border border-line px-3 py-2" />

      <label class="mt-4 block text-sm font-medium" for="password">รหัสผ่าน</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password"
        class="mt-1 w-full rounded border border-line px-3 py-2" />

      <p v-if="error" class="mt-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800" role="alert">{{ error }}</p>

      <button type="submit" class="btn mt-5 w-full" :disabled="loading">
        {{ loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ' }}
      </button>

      <div class="mt-4 flex justify-between text-sm">
        <RouterLink to="/forgot-password" class="text-accent">ลืมรหัสผ่าน</RouterLink>
        <RouterLink to="/register" class="text-accent">สมัครสมาชิก</RouterLink>
      </div>
    </form>
  </main>
</template>