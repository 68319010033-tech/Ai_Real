<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AuthLayout from '../components/AuthLayout.vue'
import AuthField from '../components/AuthField.vue'

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
  <AuthLayout>
    <form class="flex flex-col rounded-3xl border border-line bg-white p-8 shadow-md sm:p-10" @submit.prevent="submit" novalidate>
      <h1 class="text-3xl font-semibold text-ink">ลืมรหัสผ่าน</h1>

      <template v-if="!sent">
        <p class="mt-2 text-sm text-muted">กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้</p>

        <div class="mt-8">
          <AuthField id="email" v-model="email" label="อีเมล" type="email" autocomplete="email" icon="mail" />
        </div>

        <p v-if="error" class="mt-4 rounded-2xl bg-red-100 px-4 py-2.5 text-sm text-red-800" role="alert">{{ error }}</p>

        <button type="submit" class="btn mt-6 h-12 w-full !rounded-full transition-opacity hover:opacity-90" :disabled="loading">
          {{ loading ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ต' }}
        </button>
      </template>

      <p v-else class="mt-6 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-ink" role="status">
        ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปแล้ว กรุณาตรวจกล่องจดหมาย
      </p>

      <p class="mt-5 text-center text-sm">
        <RouterLink to="/login" class="font-medium text-accent hover:underline">กลับไปเข้าสู่ระบบ</RouterLink>
      </p>
    </form>
  </AuthLayout>
</template>