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
const MAX_PERIOD = 12
const LUNCH = 5 // C02: ห้ามมีเรียนคาบ 5 ทุกวัน

const mode = ref('group') // group | teacher | room
const selected = ref('')

const events = computed(() => store.schedule?.events ?? [])
const slotById = computed(() => Object.fromEntries((store.schedule?.timeslots ?? []).map((t) => [t.timeslotId, t])))

// แสดงเฉพาะคาบที่ใช้จริง (อย่างน้อยถึงคาบ 9) เพื่อไม่ให้ตารางกว้างจนต้องเลื่อน
const PERIODS = computed(() => {
  let max = 9
  for (const e of events.value) {
    const t = slotById.value[e.timeslotId]
    if (t && t.period > max) max = t.period
  }
  return Array.from({ length: Math.min(max, MAX_PERIOD) }, (_, i) => i + 1)
})

// สีพื้นต่างกันตามวิชา (วิชาเดียวกันสีเดียวกัน)
const hueOf = (id) => {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
const cellStyle = (ev) => {
  const h = hueOf(ev.subjectId)
  return { background: `hsl(${h} 70% 94%)`, borderLeftColor: `hsl(${h} 50% 42%)` }
}

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
    for (let p = 1; p <= PERIODS.value.length; p++) {
      if (p === LUNCH) { out.push({ p, lunch: true, span: 1 }); continue }
      const ev = cells.value[`${di + 1}-${p}`]
      if (!ev) { out.push({ p, span: 1, ev: null, rooms: [] }); continue }
      const rooms = [ev.roomName || ev.roomId]
      let span = 1
      while (p + span <= PERIODS.value.length && p + span !== LUNCH) {
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
        <colgroup>
          <col class="c-day" />
          <col v-for="p in PERIODS" :key="p" :class="{ 'c-lunch': p === LUNCH }" />
        </colgroup>
        <thead>
          <tr><th>วัน / คาบ</th><th v-for="p in PERIODS" :key="p">{{ p === LUNCH ? 'พัก' : p }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(d, di) in DAYS" :key="d">
            <th scope="row">{{ d }}</th>
            <template v-for="c in dayRows[di]" :key="c.p">
              <td v-if="c.lunch" class="lock"><span class="muted vtext">พักเที่ยง</span></td>
              <td v-else :colspan="c.span">
                <div
                  v-if="c.ev"
                  class="ev"
                  :style="cellStyle(c.ev)"
                  :title="`${c.ev.subjectName}\n${c.ev.teacherName || c.ev.teacherId} · ${c.rooms.join(' / ')}`"
                >
                  <strong class="name">{{ c.ev.subjectName }}</strong>
                  <div class="sub">{{ c.ev.teacherName || c.ev.teacherId }} · {{ c.rooms.join(' / ') }}</div>
                  <div v-if="c.span > 1" class="sub muted">{{ c.span }} คาบ</div>
                  <span v-if="c.ev.sharedEventId" class="badge" :title="'เรียนร่วม ' + c.ev.groupIds.join('+')">ร่วม</span>
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
.grid { border-collapse: collapse; background: var(--surface); table-layout: fixed; width: 100%; min-width: 760px; }
.grid th, .grid td { border: 1px solid var(--line); padding: 4px; vertical-align: top; font-size: 12px; overflow: hidden; }
.c-day { width: 64px; }
.c-lunch { width: 28px; }
.grid thead th { background: #eef1f6; }
.grid tbody th { background: #eef1f6; text-align: left; white-space: nowrap; }
.lock { background: var(--lock); text-align: center; vertical-align: middle; padding: 2px; }
.vtext { writing-mode: vertical-rl; letter-spacing: 1px; }
.ev { border-left: 3px solid var(--accent); padding: 2px 4px; border-radius: 3px; }
.name { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.25; font-size: 12px; }
.sub { font-size: 11px; line-height: 1.25; word-break: break-word; }
.badge { display: inline-block; margin-top: 2px; padding: 0 5px; border: 1px solid var(--shared); color: var(--shared); border-radius: 4px; font-size: 10px; }
</style>
