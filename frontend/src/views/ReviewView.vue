<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWizardStore } from '../stores/wizard'
import { TABLES } from '../lib/parseDataset'
import StepNav from '../components/StepNav.vue'
import { buildCsvFiles } from '../lib/parseDataset'
import { importDataset, errorMessage } from '../api'

const sending = ref(false)
const sendError = ref('')

const router = useRouter()
const wizard = useWizardStore()
const LABELS = {
  teacher: 'ครู', room: 'ห้อง', student_group: 'กลุ่มเรียน', subject: 'รายวิชา',
  teach: 'ครูผู้สอนรายวิชา', register: 'ลงทะเบียนเรียน', timeslot: 'คาบเวลา',
}
const names = Object.keys(TABLES)
const active = ref(names[0])

const tb = computed(() => wizard.tables[active.value])
const cols = computed(() => TABLES[active.value])
const candidates = computed(() => wizard.candidates(active.value))
const unused = computed(() => wizard.sources.filter((s) => !s.table))

// เซลล์ที่มีปัญหาในตารางที่เปิดอยู่ key = "แถว|คอลัมน์"
const bad = computed(() => {
  const m = new Map()
  const t = tb.value
  if (!t || !wizard.importResult) return m
  for (const e of wizard.importResult.errors) {
    if (e.file === t.file && e.sheet === (t.sheet ?? '-')) {
      const k = `${e.row}|${e.column}`
      if (m.get(k) !== 'error') m.set(k, e.severity)
    }
  }
  return m
})
function cellClass(r, h) {
  const s = bad.value.get(`${r._row}|${h}`) ?? bad.value.get(`${r._row}|-`)
  if (s === 'error') return 'border-red-400 bg-red-50'
  if (s === 'warning') return 'border-amber-400 bg-amber-50'
  return 'border-line'
}

async function next() {
  sendError.value = ''
  sending.value = true
  try {
    const res = await importDataset(buildCsvFiles(wizard.tables))
    // ถ้า backend ตรวจแล้วเจอ error ให้ค้างหน้านี้ ไม่ปล่อยไปต่อ
    const serverErrors = (res.errors ?? []).filter((e) => e.severity === 'error')
    if (serverErrors.length) {
      sendError.value = `เซิร์ฟเวอร์ตรวจพบ error ${serverErrors.length} รายการ: ${serverErrors[0].message}`
      return
    }
    wizard.setDatasetVersion(res.datasetVersion)
    wizard.markReviewed()
    router.push('/generate')
  } catch (e) {
    sendError.value = errorMessage(e)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <template v-if="wizard.importResult">
    <h1 class="text-2xl font-bold">ตรวจรายละเอียดไฟล์</h1>
    <p class="mt-1 text-muted">แก้ข้อมูลในตารางได้โดยตรง ระบบตรวจซ้ำให้ทันที (การแก้อยู่ในเบราว์เซอร์ ไม่แก้ไฟล์ต้นฉบับ)</p>

    <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <button
        v-for="n in names" :key="n" type="button"
        class="rounded-lg border bg-white p-4 text-left"
        :class="active === n ? 'border-accent ring-1 ring-accent' : 'border-line'"
        @click="active = n"
      >
        <p class="text-2xl font-bold">{{ wizard.importResult.counts[n] }}</p>
        <p class="text-sm text-muted">{{ LABELS[n] }} <span class="text-xs">({{ n }})</span></p>
      </button>
    </div>

    <p v-if="unused.length" class="mt-3 text-sm text-muted">
      ไม่ได้ใช้ (หัวคอลัมน์ไม่ตรงตาราง):
      <span v-for="(u, i) in unused" :key="i">{{ u.file }}{{ u.sheet ? ' / ' + u.sheet : '' }}{{ i < unused.length - 1 ? ', ' : '' }}</span>
    </p>

    <section class="mt-6">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-semibold">{{ LABELS[active] }} ({{ active }})</h2>
        <select
          v-if="candidates.length > 1"
          class="rounded border border-line bg-white px-2 py-1 text-sm"
          :value="wizard.choice[active] ?? 0"
          @change="wizard.pick(active, Number($event.target.value))"
        >
          <option v-for="(c, i) in candidates" :key="i" :value="i">{{ c.file }}{{ c.sheet ? ' / ' + c.sheet : '' }}</option>
        </select>
        <span v-else-if="tb" class="text-sm text-muted">{{ tb.file }}{{ tb.sheet ? ' / ' + tb.sheet : '' }}</span>
        <button
          v-if="tb && wizard.isEdited(tb)" type="button"
          class="btn-ghost text-sm" @click="wizard.resetSource(tb)"
        >คืนค่าเดิมของตารางนี้</button>
      </div>

      <p v-if="!tb" class="mt-2 text-red-700">ไม่พบตารางนี้ในไฟล์ที่อัปโหลด</p>
      <div v-else class="mt-3 max-h-96 overflow-auto rounded-lg border border-line bg-white">
        <table class="w-full text-left text-sm">
          <thead class="sticky top-0 bg-canvas">
            <tr>
              <th class="p-2 text-muted">แถว</th>
              <th v-for="h in cols" :key="h" class="p-2">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in tb.rows" :key="r._row" class="border-t border-line">
              <td class="p-2 text-muted">{{ r._row }}</td>
              <td v-for="h in cols" :key="h" class="p-1">
                <input
                  :value="r[h]" type="text"
                  class="w-full min-w-24 rounded border px-2 py-1"
                  :class="cellClass(r, h)"
                  @change="wizard.editCell(r, h, $event.target.value)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <h2 class="mt-8 text-lg font-semibold">ข้อผิดพลาดและคำเตือน</h2>
    <p v-if="!wizard.importResult.errors.length" class="mt-2 text-green-700">ไม่พบปัญหา</p>
    <div v-else class="mt-2 max-h-96 overflow-auto rounded-lg border border-line bg-white">
      <table class="w-full text-left text-sm">
        <thead class="sticky top-0 bg-canvas">
          <tr><th class="p-3">ระดับ</th><th class="p-3">รหัส</th><th class="p-3">ไฟล์</th><th class="p-3">Sheet</th><th class="p-3">แถว</th><th class="p-3">คอลัมน์</th><th class="p-3">รายละเอียด</th></tr>
        </thead>
        <tbody>
          <tr v-for="(er, i) in wizard.importResult.errors" :key="i" class="border-t border-line">
            <td class="p-3">
              <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="er.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'">
                {{ er.severity }}
              </span>
            </td>
            <td class="p-3">{{ er.code }}</td><td class="p-3">{{ er.file }}</td><td class="p-3">{{ er.sheet ?? '-' }}</td>
            <td class="p-3">{{ er.row }}</td><td class="p-3">{{ er.column }}</td><td class="p-3">{{ er.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="wizard.blockingErrors.length" class="mt-4 text-red-700" role="alert">
      มีข้อผิดพลาดระดับ error {{ wizard.blockingErrors.length }} รายการ ต้องแก้ก่อนไปต่อ
    </p>

    <p v-if="sendError" class="mt-4 text-red-700" role="alert">{{ sendError }}</p>
    <StepNav back="/upload" :next-label="sending ? 'กำลังส่งข้อมูล…' : 'ไปจัดตาราง'" :next-disabled="wizard.blockingErrors.length > 0 || sending" @next="next" />
  </template>
  <p v-else class="text-muted">ยังไม่มีข้อมูล กลับไปอัปโหลดไฟล์ก่อน</p>
</template>