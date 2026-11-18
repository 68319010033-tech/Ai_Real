<script setup>
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { errorMessage } from '../api'
import AuthLayout from '../components/AuthLayout.vue'
import AuthField from '../components/AuthField.vue'

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
    error.value = errorMessage(e) || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <form class="flex flex-col rounded-3xl border border-line bg-white p-8 shadow-md sm:p-10" @submit.prevent="submit" novalidate>
      <h1 class="text-3xl font-semibold text-ink">เข้าสู่ระบบ</h1>
      <p class="mt-2 text-sm text-muted">ยินดีต้อนรับกลับมา กรุณาเข้าสู่ระบบเพื่อใช้งานต่อ</p>

      <div class="mt-8 flex flex-col gap-5">
        <AuthField id="email" v-model="email" label="อีเมล" type="email" autocomplete="email" icon="mail" />
        <AuthField id="password" v-model="password" label="รหัสผ่าน" type="password" autocomplete="current-password" icon="lock" />
      </div>

      <div class="mt-3 flex justify-end">
        <RouterLink to="/forgot-password" class="text-sm text-accent hover:underline">ลืมรหัสผ่าน?</RouterLink>
      </div>

      <p v-if="error" class="mt-4 rounded-2xl bg-red-100 px-4 py-2.5 text-sm text-red-800" role="alert">{{ error }}</p>

      <button type="submit" class="btn mt-6 h-12 w-full !rounded-full transition-opacity hover:opacity-90" :disabled="loading">
        {{ loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ' }}
      </button>

      <p class="mt-5 text-center text-sm text-muted">
        ยังไม่มีบัญชี? <RouterLink to="/register" class="font-medium text-accent hover:underline">สมัครสมาชิก</RouterLink>
      </p>
    </form>
  </AuthLayout>
</template>