<script setup>
import { useRouter } from 'vue-router'
import { useWizardStore } from '../stores/wizard'
import StepNav from '../components/StepNav.vue'

const router = useRouter()
const wizard = useWizardStore()
const LABELS = {
  teacher: 'ครู', room: 'ห้อง', student_group: 'กลุ่มเรียน', subject: 'รายวิชา',
  teach: 'ครูผู้สอนรายวิชา', register: 'ลงทะเบียนเรียน', timeslot: 'คาบเวลา',
}
function next() {
  wizard.markReviewed()
  router.push('/generate')
}
</script>

<template>
  <template v-if="wizard.importResult">
    <h1 class="text-2xl font-bold">ตรวจรายละเอียดไฟล์</h1>
    <p class="mt-1 text-muted">เวอร์ชันข้อมูล {{ wizard.importResult.datasetVersion }}</p>

    <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div v-for="(n, name) in wizard.importResult.counts" :key="name" class="rounded-lg border border-line bg-white p-4">
        <p class="text-2xl font-bold">{{ n }}</p>
        <p class="text-sm text-muted">{{ LABELS[name] ?? name }} <span class="text-xs">({{ name }})</span></p>
      </div>
    </div>

    <h2 class="mt-8 text-lg font-semibold">ข้อผิดพลาดและคำเตือน</h2>
    <p v-if="!wizard.importResult.errors.length" class="mt-2 text-green-700">ไม่พบปัญหา</p>
    <div v-else class="mt-2 overflow-x-auto rounded-lg border border-line bg-white">
      <table class="w-full text-left text-sm">
        <thead class="bg-canvas">
          <tr><th class="p-3">ระดับ</th><th class="p-3">รหัส</th><th class="p-3">ไฟล์</th><th class="p-3">Sheet</th><th class="p-3">แถว</th><th class="p-3">คอลัมน์</th><th class="p-3">รายละเอียด</th></tr>
        </thead>
        <tbody>
          <tr v-for="(er, i) in wizard.importResult.errors" :key="i" class="border-t border-line">
            <td class="p-3">
              <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="er.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'">
                {{ er.severity === 'error' ? 'error' : 'warning' }}
              </span>
            </td>
            <td class="p-3">{{ er.code }}</td><td class="p-3">{{ er.file }}</td><td class="p-3">{{ er.sheet ?? '-' }}</td>
            <td class="p-3">{{ er.row }}</td><td class="p-3">{{ er.column }}</td><td class="p-3">{{ er.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="wizard.blockingErrors.length" class="mt-4 text-red-700" role="alert">
      มีข้อผิดพลาดระดับ error {{ wizard.blockingErrors.length }} รายการ ต้องแก้ไฟล์แล้วอัปโหลดใหม่ก่อนไปต่อ
    </p>

    <StepNav back="/upload" next-label="ไปจัดตาราง" :next-disabled="wizard.blockingErrors.length > 0" @next="next" />
  </template>
</template>