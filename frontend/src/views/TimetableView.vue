<script setup>
import { computed, onMounted, ref } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { useWizardStore } from '../stores/wizard'
import StepNav from '../components/StepNav.vue'
import ValidationPanel from '../components/ValidationPanel.vue'

const store = useScheduleStore()
const wizard = useWizardStore()
onMounted(async () => {
  await store.load()
  if (!store.error) wizard.markViewed()
})

const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์']
const PERIODS = Array.from({ length: 12 }, (_, i) => i + 1)
const LUNCH = 5 // C02: ห้ามมีเรียนคาบ 5 ทุกวัน

const mode = ref('group') // group | teacher | room
const selected = ref('')

const events = computed(() => store.schedule?.events ?? [])
const slotById = computed(() => Object.fromEntries((store.schedule?.timeslots ?? []).map((t) => [t.timeslotId, t])))

const options = computed(() => {
  const set = new Set()
  for (const e of events.value) {
    if (mode.value === 'group') e.groupIds.forEach((g) => set.add(g))
    if (mode.value === 'teacher') set.add(e.teacherId)
    if (mode.value === 'room') set.add(e.roomId)
  }
  return [...set].sort()
})

// id -> ชื่อ สำหรับตัวเลือกครู/ห้อง (ถ้าไม่มีชื่อใช้ id)
const nameOf = computed(() => {
  const m = { teacher: {}, room: {} }
  for (const e of events.value) {
    m.teacher[e.teacherId] = e.teacherName || e.teacherId
    m.room[e.roomId] = e.roomName || e.roomId
  }
  return m
})
const labelOf = (id) => {
  const name = mode.value === 'group' ? id : nameOf.value[mode.value]?.[id] || id
  return name === id ? id : `${name} (${id})`
}

const current = computed(() => (options.value.includes(selected.value) ? selected.value : options.value[0] ?? ''))

const cells = computed(() => {
  const map = {}
  for (const e of events.value) {
    const match =
      (mode.value === 'group' && e.groupIds.includes(current.value)) ||
      (mode.value === 'teacher' && e.teacherId === current.value) ||
      (mode.value === 'room' && e.roomId === current.value)
    if (!match) continue
    const t = slotById.value[e.timeslotId]
    if (t) map[`${t.day}-${t.period}`] = e
  }
  return map
})

// รวมคาบติดกันที่เป็นวิชา+ครูเดียวกัน (ไม่ข้ามพักเที่ยง) ให้เป็นช่องเดียว
const dayRows = computed(() =>
  DAYS.map((_, di) => {
    const out = []
    for (let p = 1; p <= PERIODS.length; p++) {
      if (p === LUNCH) { out.push({ p, lunch: true, span: 1 }); continue }
      const ev = cells.value[`${di + 1}-${p}`]
      if (!ev) { out.push({ p, span: 1, ev: null, rooms: [] }); continue }
      const rooms = [ev.roomName || ev.roomId]
      let span = 1
      while (p + span <= PERIODS.length && p + span !== LUNCH) {
        const nx = cells.value[`${di + 1}-${p + span}`]
        if (!nx || nx.subjectId !== ev.subjectId || nx.teacherId !== ev.teacherId) break
        const r = nx.roomName || nx.roomId
        if (!rooms.includes(r)) rooms.push(r)
        span++
      }
      out.push({ p, span, ev, rooms })
      p += span - 1
    }
    return out
  }),
)
</script>

<template>
  <h1 class="mb-4 text-2xl font-bold">ตารางสอน</h1>
  <p v-if="store.loading" class="muted">กำลังโหลดตาราง…</p>
  <p v-else-if="store.error" class="err" role="alert">
    {{ store.error }} <button class="btn btn-ghost" @click="store.load()">ลองใหม่</button>
  </p>
  <p v-else-if="!events.length" class="muted">ยังไม่มีตาราง ไปที่ “นำเข้าข้อมูล” แล้วสั่งจัดตารางก่อน</p>

  <template v-else>
    <section class="panel">
      <label>มุมมอง
        <select v-model="mode" @change="selected = ''">
          <option value="group">กลุ่มเรียน</option>
          <option value="teacher">ครู</option>
          <option value="room">ห้อง</option>
        </select>
      </label>
      <label>
        <select v-model="selected" :aria-label="'เลือก' + mode">
          <option v-for="o in options" :key="o" :value="o">{{ labelOf(o) }}</option>
        </select>
      </label>
      <span class="muted">สถานะ solver: {{ store.schedule.solverStatus }} · ข้อมูล: {{ store.schedule.datasetVersion }}</span>
    </section>

    <div class="scroll">
      <table class="grid">
        <thead>
          <tr><th>วัน</th><th v-for="p in PERIODS" :key="p">คาบ {{ p }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(d, di) in DAYS" :key="d">
            <th scope="row">{{ d }}</th>
            <template v-for="c in dayRows[di]" :key="c.p">
              <td v-if="c.lunch" class="lock"><span class="muted">พักเที่ยง</span></td>
              <td v-else :colspan="c.span">
                <div v-if="c.ev" class="ev">
                  <strong>{{ c.ev.subjectName }}</strong>
                  <div>{{ c.ev.teacherName || c.ev.teacherId }} · {{ c.rooms.join(' / ') }}</div>
                  <div class="muted">{{ c.ev.component }}<template v-if="c.span > 1"> · {{ c.span }} คาบ</template></div>
                  <span v-if="c.ev.sharedEventId" class="badge">เรียนร่วม {{ c.ev.groupIds.join('+') }}</span>
                </div>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
        <ValidationPanel :schedule-id="store.schedule.scheduleId" class="mt-8" />
      <StepNav back="/generate" next-label="ส่งออกไฟล์" :next-disabled="!store.schedule" @next="$router.push('/export')" />
  </template>
</template>

<style scoped>
.panel { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.grid { border-collapse: collapse; background: var(--surface); min-width: 1100px; width: 100%; }
.grid th, .grid td { border: 1px solid var(--line); padding: 6px; vertical-align: top; min-width: 90px; font-size: 13px; }
.grid thead th { background: #eef1f6; }
.grid tbody th { background: #eef1f6; text-align: left; white-space: nowrap; }
.lock { background: var(--lock); text-align: center; vertical-align: middle; }
.ev { border-left: 3px solid var(--accent); padding-left: 6px; }
.badge { display: inline-block; margin-top: 4px; padding: 1px 6px; border: 1px solid var(--shared); color: var(--shared); border-radius: 4px; font-size: 11px; }
</style>
