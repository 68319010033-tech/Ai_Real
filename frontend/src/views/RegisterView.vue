<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { errorMessage } from '../api'
import AuthLayout from '../components/AuthLayout.vue'
import AuthField from '../components/AuthField.vue'

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
    error.value = errorMessage(e) || 'สมัครสมาชิกไม่สำเร็จ ลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <form class="flex flex-col rounded-3xl border border-line bg-white p-8 shadow-md sm:p-10" @submit.prevent="submit" novalidate>
      <h1 class="text-3xl font-semibold text-ink">สมัครสมาชิก</h1>
      <p class="mt-2 text-sm text-muted">สร้างบัญชีเพื่อเริ่มจัดตารางสอน</p>

      <div class="mt-8 flex flex-col gap-5">
        <AuthField id="email" v-model="email" label="อีเมล" type="email" autocomplete="email" icon="mail" />
        <AuthField id="password" v-model="password" label="รหัสผ่าน (อย่างน้อย 8 ตัว)" type="password" autocomplete="new-password" icon="lock" />
        <AuthField id="confirm" v-model="confirm" label="ยืนยันรหัสผ่าน" type="password" autocomplete="new-password" icon="lock" />
      </div>

      <p v-if="error" class="mt-4 rounded-2xl bg-red-100 px-4 py-2.5 text-sm text-red-800" role="alert">{{ error }}</p>

      <button type="submit" class="btn mt-6 h-12 w-full !rounded-full transition-opacity hover:opacity-90" :disabled="loading">
        {{ loading ? 'กำลังสมัคร...' : 'สมัครสมาชิก' }}
      </button>

      <p class="mt-5 text-center text-sm text-muted">
        มีบัญชีอยู่แล้ว? <RouterLink to="/login" class="font-medium text-accent hover:underline">เข้าสู่ระบบ</RouterLink>
      </p>
    </form>
  </AuthLayout>
</template>