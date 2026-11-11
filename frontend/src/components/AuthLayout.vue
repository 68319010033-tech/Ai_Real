<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

// ---------- ข้อมูลตารางสอนจำลอง ----------
// type: pro = วิชาชีพ, gen = วิชาพื้นฐาน, shared = เรียนร่วม 2 กลุ่ม, free = คาบว่าง
const periods = [
  { n: 1, time: '08:30' },
  { n: 2, time: '09:30' },
  { n: 3, time: '10:30' },
  { n: 4, time: '13:00' },
  { n: 5, time: '14:00' },
]
const rows = [
  { day: 'จ.', cells: [
    { t: 'pro', s: 'เขียนโปรแกรม', r: 'LAB 4' },
    { t: 'pro', s: 'เขียนโปรแกรม', r: 'LAB 4' },
    { t: 'gen', s: 'คณิตศาสตร์', r: '201' },
    { t: 'free' },
    { t: 'shared', s: 'ปัญญาประดิษฐ์', r: 'LAB 1' },
  ] },
  { day: 'อ.', cells: [
    { t: 'gen', s: 'ภาษาอังกฤษ', r: '305' },
    { t: 'pro', s: 'ฐานข้อมูล', r: 'LAB 2' },
    { t: 'pro', s: 'ฐานข้อมูล', r: 'LAB 2' },
    { t: 'pro', s: 'เครือข่าย', r: 'LAB 3' },
    { t: 'free' },
  ] },
  { day: 'พ.', cells: [
    { t: 'pro', s: 'เว็บแอป', r: 'LAB 4' },
    { t: 'pro', s: 'เว็บแอป', r: 'LAB 4' },
    { t: 'free' },
    { t: 'gen', s: 'พลศึกษา', r: 'สนาม' },
    { t: 'pro', s: 'เครือข่าย', r: 'LAB 3' },
  ] },
  { day: 'พฤ.', cells: [
    { t: 'shared', s: 'ปัญญาประดิษฐ์', r: 'LAB 1' },
    { t: 'shared', s: 'ปัญญาประดิษฐ์', r: 'LAB 1' },
    { t: 'gen', s: 'ภาษาอังกฤษ', r: '305' },
    { t: 'pro', s: 'ระบบปฏิบัติการ', r: 'LAB 2' },
    { t: 'free' },
  ] },
  { day: 'ศ.', cells: [
    { t: 'gen', s: 'คณิตศาสตร์', r: '201' },
    { t: 'free' },
    { t: 'pro', s: 'โปรเจกต์', r: 'LAB 4' },
    { t: 'pro', s: 'โปรเจกต์', r: 'LAB 4' },
    { t: 'gen', s: 'กิจกรรม', r: '101' },
  ] },
]

const TOTAL = rows.length * periods.length // 25 ช่อง
const START_CONFLICTS = 14

// ลำดับการวางแบบกระจาย (เหมือน solver ลองทีละช่อง) — 7 กับ 25 ไม่มีตัวหารร่วม จึงครบทุกช่องไม่ซ้ำ
const orderOf = (r, c) => ((r * periods.length + c) * 7) % TOTAL

const classes = {
  pro: 'border-transparent bg-accent text-white',
  gen: 'border-transparent bg-accent-soft text-ink',
  shared: 'border-transparent bg-[var(--shared)] text-white',
  free: 'border-white/10 bg-white/[.06] text-white/40',
}

// ---------- อนิเมชัน: เล่นครั้งเดียวต่อการเปิดเว็บ ----------
let played = false // ระดับ module: สลับ Login <-> Register แล้วไม่เล่นซ้ำ
const step = ref(0)
let timer = null

const done = computed(() => step.value >= TOTAL)
const conflicts = computed(() => Math.round(START_CONFLICTS * (1 - Math.min(step.value, TOTAL) / TOTAL)))

onMounted(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (played || reduce) { step.value = TOTAL; return }
  played = true
  setTimeout(() => {
    timer = setInterval(() => {
      step.value++
      if (step.value >= TOTAL) clearInterval(timer)
    }, 80)
  }, 350)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <main class="flex min-h-screen w-full bg-white">
    <!-- ฝั่งซ้าย (จอ lg ขึ้นไป) -->
    <aside class="hidden w-[54%] shrink-0 flex-col justify-between bg-side p-10 text-white lg:flex xl:p-14">
      <div>
        <p class="text-lg font-semibold">ระบบจัดตารางสอนอัตโนมัติ</p>
        <p class="mt-2 max-w-md text-sm leading-relaxed text-white/70">
          นำเข้าข้อมูล ตรวจเงื่อนไข และสร้างตารางสอนที่ไม่ชนกันได้ในไม่กี่ขั้นตอน
        </p>
      </div>

      <!-- ตารางสอนจำลอง -->
      <div class="my-8" aria-hidden="true">
        <div class="rounded-2xl border border-white/10 bg-white/[.04] p-4 xl:p-5">
          <!-- แถบหัวตาราง + สถานะ solver -->
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium">ตารางสอน ปวส.2/1</p>
              <p class="text-xs text-white/50">ภาคเรียนที่ 2/2569</p>
            </div>
            <div
              class="flex items-center gap-2 rounded-full border px-3 py-1 text-xs tabular-nums transition-colors duration-500"
              :class="done ? 'border-accent bg-accent/20 text-white' : 'border-white/15 text-white/70'"
            >
              <svg v-if="done" class="h-3.5 w-3.5 text-accent-soft" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              <span v-else class="h-2 w-2 animate-pulse rounded-full bg-accent-soft"></span>
              <span>{{ done ? 'จัดตารางสำเร็จ' : 'กำลังจัดตาราง' }} · ชนกัน {{ conflicts }}</span>
            </div>
          </div>

          <!-- ตาราง -->
          <div class="grid grid-cols-[2rem_repeat(5,minmax(0,1fr))] gap-1.5 xl:gap-2">
            <span></span>
            <div v-for="p in periods" :key="p.n" class="pb-1 text-center leading-tight">
              <p class="text-[11px] font-medium text-white/80">คาบ {{ p.n }}</p>
              <p class="text-[10px] text-white/45">{{ p.time }}</p>
            </div>

            <template v-for="(row, r) in rows" :key="row.day">
              <span class="flex items-center text-xs font-medium text-white/70">{{ row.day }}</span>
              <div
                v-for="(cell, c) in row.cells"
                :key="r + '-' + c"
                class="flex h-14 flex-col justify-center rounded-lg border px-2 text-[11px] leading-tight transition-all duration-300 ease-out xl:h-16 xl:text-xs"
                :class="
                  orderOf(r, c) < step
                    ? [classes[cell.t], 'scale-100 opacity-100']
                    : 'scale-90 border-dashed border-white/15 bg-transparent text-transparent opacity-60'
                "
              >
                <template v-if="cell.t === 'free'">
                  <span class="text-center">ว่าง</span>
                </template>
                <template v-else>
                  <span class="font-medium">{{ cell.s }}</span>
                  <span class="mt-0.5 text-[10px] opacity-75">{{ cell.r }}</span>
                </template>
              </div>
            </template>
          </div>

          <!-- คำอธิบายสี -->
          <div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/65">
            <span class="flex items-center gap-2"><i class="inline-block h-3 w-3 rounded bg-accent"></i>วิชาชีพ</span>
            <span class="flex items-center gap-2"><i class="inline-block h-3 w-3 rounded bg-accent-soft"></i>วิชาพื้นฐาน</span>
            <span class="flex items-center gap-2"><i class="inline-block h-3 w-3 rounded bg-[var(--shared)]"></i>เรียนร่วม 2 กลุ่ม</span>
          </div>
        </div>
      </div>

      <p class="text-xs text-white/50">AI Timetable · สร้างด้วย OR-Tools CP-SAT</p>
    </aside>

    <!-- ฝั่งขวา: ฟอร์ม -->
    <section class="flex w-full flex-1 items-center justify-center bg-canvas p-6 lg:bg-white">
      <div class="w-full max-w-sm">
        <slot />
      </div>
    </section>
  </main>
</template>