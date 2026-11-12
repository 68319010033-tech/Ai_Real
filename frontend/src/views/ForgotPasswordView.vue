<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { errorMessage } from '../api'
import AuthLayout from '../components/AuthLayout.vue'
import AuthField from '../components/AuthField.vue'

const auth = useAuthStore()

// step: 'email' -> กรอกอีเมลเพื่อขอ OTP, 'reset' -> กรอก OTP + รหัสผ่านใหม่, 'done' -> สำเร็จ
const step = ref('email')
const email = ref('')
const otp = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const info = ref('')
const loading = ref(false)

async function requestOtp() {
  error.value = ''
  info.value = ''
  if (!/^\S+@\S+\.\S+$/.test(email.value)) { error.value = 'รูปแบบอีเมลไม่ถูกต้อง'; return }
  loading.value = true
  try {
    await auth.forgotPassword(email.value)
    step.value = 'reset'
  } catch (e) {
    error.value = errorMessage(e) || 'ส่งคำขอไม่สำเร็จ ลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}

async function resendOtp() {
  error.value = ''
  info.value = ''
  loading.value = true
  try {
    await auth.forgotPassword(email.value)
    info.value = 'ส่งรหัส OTP ใหม่แล้ว'
  } catch (e) {
    error.value = errorMessage(e) || 'ส่งคำขอไม่สำเร็จ ลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}

async function submitReset() {
  error.value = ''
  info.value = ''
  if (!/^\d{6}$/.test(otp.value.trim())) { error.value = 'กรุณากรอกรหัส OTP 6 หลัก'; return }
  if (password.value.length < 8) { error.value = 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'; return }
  if (password.value !== confirm.value) { error.value = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'; return }
  loading.value = true
  try {
    await auth.resetPassword(email.value, otp.value.trim(), password.value)
    step.value = 'done'
  } catch (e) {
    error.value = errorMessage(e) || 'รีเซ็ตรหัสผ่านไม่สำเร็จ ลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}

function changeEmail() {
  step.value = 'email'
  otp.value = ''
  password.value = ''
  confirm.value = ''
  error.value = ''
  info.value = ''
}
</script>

<template>
  <AuthLayout>
    <!-- ขั้นที่ 1: กรอกอีเมล -->
    <form v-if="step === 'email'" class="flex flex-col rounded-3xl border border-line bg-white p-8 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.35)] sm:p-14" @submit.prevent="requestOtp" novalidate>
      <h1 class="text-3xl font-semibold text-ink">ลืมรหัสผ่าน</h1>
      <p class="mt-2 text-sm text-muted">กรอกอีเมลที่ใช้สมัคร เราจะส่งรหัส OTP 6 หลักให้ทางอีเมล</p>

      <div class="mt-8">
        <AuthField id="email" v-model="email" label="อีเมล" type="email" autocomplete="email" icon="mail" />
      </div>

      <p v-if="error" class="mt-4 rounded-2xl bg-red-100 px-4 py-2.5 text-sm text-red-800" role="alert">{{ error }}</p>

      <button type="submit" class="btn mt-6 h-12 w-full !rounded-full transition-opacity hover:opacity-90" :disabled="loading">
        {{ loading ? 'กำลังส่ง...' : 'ส่งรหัส OTP' }}
      </button>

      <p class="mt-5 text-center text-sm">
        <RouterLink to="/login" class="font-medium text-accent hover:underline">กลับไปเข้าสู่ระบบ</RouterLink>
      </p>
    </form>

    <!-- ขั้นที่ 2: กรอก OTP และรหัสผ่านใหม่ -->
    <form v-else-if="step === 'reset'" class="flex flex-col rounded-3xl border border-line bg-white p-8 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.35)] sm:p-14" @submit.prevent="submitReset" novalidate>
      <h1 class="text-3xl font-semibold text-ink">ตั้งรหัสผ่านใหม่</h1>
      <p class="mt-2 text-sm text-muted">
        ถ้าอีเมล <span class="font-medium text-ink">{{ email }}</span> มีอยู่ในระบบ เราได้ส่งรหัส OTP ไปแล้ว (หมดอายุใน 10 นาที) ตรวจสอบกล่องจดหมายและสแปม
      </p>

      <div class="mt-8 flex flex-col gap-5">
        <AuthField id="otp" v-model="otp" label="รหัส OTP 6 หลัก" type="text" autocomplete="one-time-code" icon="lock" />
        <AuthField id="new-password" v-model="password" label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)" type="password" autocomplete="new-password" icon="lock" />
        <AuthField id="confirm" v-model="confirm" label="ยืนยันรหัสผ่านใหม่" type="password" autocomplete="new-password" icon="lock" />
      </div>

      <p v-if="error" class="mt-4 rounded-2xl bg-red-100 px-4 py-2.5 text-sm text-red-800" role="alert">{{ error }}</p>
      <p v-if="info" class="mt-4 rounded-2xl bg-accent-soft px-4 py-2.5 text-sm text-ink" role="status">{{ info }}</p>

      <button type="submit" class="btn mt-6 h-12 w-full !rounded-full transition-opacity hover:opacity-90" :disabled="loading">
        {{ loading ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน' }}
      </button>

      <div class="mt-5 flex justify-between text-sm">
        <button type="button" class="font-medium text-accent hover:underline disabled:opacity-50" :disabled="loading" @click="resendOtp">ส่งรหัสอีกครั้ง</button>
        <button type="button" class="font-medium text-accent hover:underline" @click="changeEmail">เปลี่ยนอีเมล</button>
      </div>
    </form>

    <!-- ขั้นที่ 3: สำเร็จ -->
    <div v-else class="flex flex-col rounded-3xl border border-line bg-white p-8 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.35)] sm:p-14">
      <h1 class="text-3xl font-semibold text-ink">เปลี่ยนรหัสผ่านสำเร็จ</h1>
      <p class="mt-6 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-ink" role="status">
        รีเซ็ตรหัสผ่านเรียบร้อยแล้ว ใช้รหัสผ่านใหม่เข้าสู่ระบบได้เลย
      </p>
      <RouterLink to="/login" class="btn mt-6 flex h-12 w-full items-center justify-center !rounded-full transition-opacity hover:opacity-90">
        ไปหน้าเข้าสู่ระบบ
      </RouterLink>
    </div>
  </AuthLayout>
</template>