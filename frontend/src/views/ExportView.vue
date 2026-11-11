<script setup>
import { reactive } from 'vue'
import { exportSchedule, errorMessage } from '../api'
import { useWizardStore } from '../stores/wizard'
import StepNav from '../components/StepNav.vue'

const wizard = useWizardStore()
const formats = [
  { key: 'csv', title: 'CSV ทางการ', desc: 'ห้าคอลัมน์ตามรูปแบบที่กำหนด: group_id, timeslot_id, subject_id, teacher_id, room_id', file: 'output.csv' },
  { key: 'xlsx', title: 'Excel', desc: 'ตารางอ่านง่าย แยกตามกลุ่ม ครู ห้อง', file: 'timetable.xlsx' },
  { key: 'pdf', title: 'PDF', desc: 'พร้อมพิมพ์ รองรับตัวอักษรไทย', file: 'timetable.pdf' },
]
const busy = reactive({})
const errors = reactive({})

async function download(f) {
  busy[f.key] = true
  errors[f.key] = ''
  try {
    const blob = await exportSchedule(f.key, wizard.scheduleId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = f.file
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    errors[f.key] = errorMessage(e)
  } finally {
    busy[f.key] = false
  }
}
</script>

<template>
  <h1 class="text-2xl font-bold">ส่งออกไฟล์</h1>
  <p class="mt-1 text-muted">ดาวน์โหลดตารางที่จัดเสร็จแล้ว</p>

  <div class="mt-6 grid gap-4 md:grid-cols-3">
    <section v-for="f in formats" :key="f.key" class="flex flex-col rounded-lg border border-line bg-white p-5">
      <h2 class="font-semibold">{{ f.title }}</h2>
      <p class="mt-1 flex-1 text-sm text-muted">{{ f.desc }}</p>
      <button class="btn mt-4" :disabled="busy[f.key]" @click="download(f)">
        {{ busy[f.key] ? 'กำลังเตรียมไฟล์…' : 'ดาวน์โหลด' }}
      </button>
      <p v-if="errors[f.key]" class="mt-2 text-sm text-red-700" role="alert">{{ errors[f.key] }}</p>
    </section>
  </div>

  <StepNav back="/timetable" />
</template>