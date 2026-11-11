<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const email = ref('')
const error = ref('')
const sent = ref(false)
const loading = ref(false)

async function submit() {
  error.value = ''
  if (!/^\S+@\S+\.\S+$/.test(email.value)) { error.value = 'รูปแบบอีเมลไม่ถูกต้อง'; return }
  loading.value = true
  try {
    await auth.forgotPassword(email.value)
    sent.value = true
  } catch (e) {
    error.value = 'ส่งคำขอไม่สำเร็จ ลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-canvas p-4">
    <form class="w-full max-w-sm rounded-lg border border-line bg-white p-6" @submit.prevent="submit" novalidate>
      <h1 class="text-2xl font-bold">ลืมรหัสผ่าน</h1>

      <template v-if="!sent">
        <p class="mt-1 text-sm text-muted">กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้</p>
        <label class="mt-5 block text-sm font-medium" for="email">อีเมล</label>
        <input id="email" v-model="email" type="email" autocomplete="email"
          class="mt-1 w-full rounded border border-line px-3 py-2" />
        <p v-if="error" class="mt-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800" role="alert">{{ error }}</p>
        <button type="submit" class="btn mt-5 w-full" :disabled="loading">
          {{ loading ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ต' }}
        </button>
      </template>

      <p v-else class="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700" role="status">
        ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปแล้ว กรุณาตรวจกล่องจดหมาย
      </p>

      <p class="mt-4 text-sm"><RouterLink to="/login" class="text-accent">กลับไปเข้าสู่ระบบ</RouterLink></p>
    </form>
  </main>
</template>