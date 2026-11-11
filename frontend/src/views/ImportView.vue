<script setup>
import { ref } from 'vue'
import { importDataset, errorMessage } from '../api'

const MAX_MB = 20
const files = ref([])
const result = ref(null)
const error = ref('')
const loading = ref(false)

function onPick(e) {
  error.value = ''
  const picked = Array.from(e.target.files)
  const bad = picked.find((f) => !/\.(csv|xlsx)$/i.test(f.name) || f.size > MAX_MB * 1024 * 1024)
  if (bad) {
    error.value = `ไฟล์ ${bad.name} ไม่ใช่ .csv/.xlsx หรือใหญ่เกิน ${MAX_MB} MB`
    files.value = []
    return
  }
  files.value = picked
}

async function upload() {
  loading.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await importDataset(files.value)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <h1>นำเข้าข้อมูล</h1>
  <section class="panel">
    <p class="muted">เลือกไฟล์ชุดเดียวกัน (CSV หรือ XLSX) อย่าปนกัน ระบบจะไม่รวมสองชุดให้อัตโนมัติ</p>
    <input type="file" multiple accept=".csv,.xlsx" @change="onPick" />
    <p v-if="files.length" class="muted">เลือกแล้ว {{ files.length }} ไฟล์</p>
    <button :disabled="!files.length || loading" @click="upload">
      {{ loading ? 'กำลังอัปโหลด…' : 'อัปโหลดและตรวจข้อมูล' }}
    </button>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </section>

  <section v-if="result" class="panel">
    <h2>เวอร์ชันข้อมูล: {{ result.datasetVersion }}</h2>
    <ul>
      <li v-for="(n, name) in result.counts" :key="name">{{ name }}: {{ n }} แถว</li>
    </ul>
    <p v-if="!result.errors.length" class="ok">ไม่พบข้อผิดพลาด</p>
    <div v-else class="scroll">
      <table class="issues">
        <thead><tr><th>รหัส</th><th>ไฟล์</th><th>Sheet</th><th>แถว</th><th>คอลัมน์</th><th>รายละเอียด</th></tr></thead>
        <tbody>
          <tr v-for="(er, i) in result.errors" :key="i">
            <td>{{ er.code }}</td><td>{{ er.file }}</td><td>{{ er.sheet ?? '-' }}</td>
            <td>{{ er.row }}</td><td>{{ er.column }}</td><td>{{ er.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
