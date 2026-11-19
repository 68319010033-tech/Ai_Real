<script setup>
import { computed, onMounted, ref, watch } from 'vue'
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
  return {
    background: `hsl(${h} 75% 93%)`,
    borderLeftColor: `hsl(${h} 55% 45%)`,
    color: `hsl(${h} 45% 20%)`,
  }
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

// เลือกค่าเริ่มต้นให้ dropdown เสมอ: มุมมองกลุ่มเรียนเริ่มที่ G1 (ถ้ามี) ไม่ปล่อยให้ว่าง
watch(
  [options, mode],
  () => {
    if (options.value.includes(selected.value)) return
    selected.value = mode.value === 'group' && options.value.includes('G1') ? 'G1' : options.value[0] ?? ''
  },
  { immediate: true },
)

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
    <section class="panel tt-panel">
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
      <span class="tt-pill">solver: {{ store.schedule.solverStatus }}</span>
      <span class="muted">ข้อมูล: {{ store.schedule.datasetVersion }}</span>
    </section>

    <div class="scroll tt-wrap">
      <table class="tt">
        <colgroup>
          <col class="c-day" />
          <col v-for="p in PERIODS" :key="p" :class="{ 'c-lunch': p === LUNCH }" />
        </colgroup>
        <thead>
          <tr><th class="tt-corner">วัน</th><th v-for="p in PERIODS" :key="p">คาบ {{ p }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(d, di) in DAYS" :key="d">
            <th scope="row">{{ d }}</th>
            <template v-for="c in dayRows[di]" :key="c.p">
              <td v-if="c.lunch" class="tt-lunch"><span class="vtext">พักเที่ยง</span></td>
              <td v-else :colspan="c.span" class="tt-cell">
                <div
                  v-if="c.ev"
                  class="tt-ev"
                  :style="cellStyle(c.ev)"
                  :title="`${c.ev.subjectName}\n${c.ev.teacherName || c.ev.teacherId} · ${c.rooms.join(' / ')}`"
                >
                  <strong class="tt-name">{{ c.ev.subjectName }}</strong>
                  <div class="tt-sub">{{ c.ev.teacherName || c.ev.teacherId }} · {{ c.rooms.join(' / ') }}</div>
                  <div v-if="c.span > 1" class="tt-sub">{{ c.span }} คาบ</div>
                  <span v-if="c.ev.sharedEventId" class="tt-badge" :title="'เรียนร่วม ' + c.ev.groupIds.join('+')">ร่วม</span>
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
.tt-panel { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; box-shadow: 0 1px 2px rgb(20 48 74 / 6%); }
.tt-panel select { min-width: 120px; font-weight: 600; }
.tt-pill { padding: 3px 10px; border-radius: 999px; background: var(--color-accent-soft); color: var(--accent); font-size: 12px; font-weight: 600; }

/* หมายเหตุ: ห้ามใช้ชื่อคลาส "grid" เพราะชนกับ utility .grid { display: grid } ของ Tailwind ทำให้หัวตารางแยกออกจากตัวตาราง */
.tt-wrap { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: 0 2px 8px rgb(20 48 74 / 8%); }
.tt { border-collapse: collapse; table-layout: fixed; width: 100%; min-width: 820px; }
.tt th, .tt td { border: 1px solid var(--line); font-size: 12px; }
.tt thead th { background: var(--accent); color: #fff; font-weight: 600; padding: 8px 4px; border-color: rgb(255 255 255 / 25%); }
.tt thead th:first-child { border-top-left-radius: 11px; }
.tt thead th:last-child { border-top-right-radius: 11px; }
.tt tbody th { background: #eef6f6; color: var(--color-side); text-align: center; font-size: 13px; white-space: nowrap; }
.tt-corner { width: 76px; }
.tt col.c-day { width: 76px; }
.tt col.c-lunch { width: 46px; }

.tt-cell { padding: 3px; height: 92px; vertical-align: top; background: #fafbfc; }
.tt-lunch { background: repeating-linear-gradient(135deg, var(--lock), var(--lock) 6px, #eef1f5 6px, #eef1f5 12px); text-align: center; vertical-align: middle; color: var(--color-muted); }
.vtext { writing-mode: vertical-rl; letter-spacing: 2px; font-size: 12px; }

/* การ์ดวิชาเต็มช่อง */
.tt-ev { box-sizing: border-box; height: 100%; padding: 6px 8px; border-left: 4px solid var(--accent); border-radius: 8px; display: flex; flex-direction: column; gap: 2px; overflow: hidden; transition: box-shadow .15s; }
.tt-ev:hover { box-shadow: 0 2px 8px rgb(20 48 74 / 18%); }
.tt-name { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; font-size: 12.5px; line-height: 1.3; }
.tt-sub { font-size: 11px; line-height: 1.3; opacity: .85; word-break: break-word; }
.tt-badge { align-self: flex-start; margin-top: auto; padding: 0 6px; border: 1px solid var(--shared); color: var(--shared); background: rgb(255 255 255 / 70%); border-radius: 999px; font-size: 10px; }
</style>
