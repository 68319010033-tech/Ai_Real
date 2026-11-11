<script setup>
const model = defineModel({ type: Array, default: () => [] })
defineProps({ disabled: Boolean })

import { ref } from 'vue'

const MAX = 2 // วันแข่งสุ่มจับ 2 เงื่อนไข
const limitMode = ref(true) // โหมดแข่งขัน: จำกัดไม่เกิน MAX ข้อ

// เงื่อนไขพื้นฐาน (ไฟล์ 03) เปิดเสมอ แสดงอย่างเดียว
const BASE = [
    { id: 'C01', text: 'จำนวนคาบรายวิชา = theory + practice' },
    { id: 'C02', text: 'ห้ามเรียนคาบ 5 (พักเที่ยง) ทุกวัน' },
    { id: 'C03', text: 'จำนวนวิชาเท่ากับที่ลงทะเบียน' },
    { id: 'C04', text: 'คาบรวมเท่ากับผลรวมคาบวิชาที่ลงทะเบียน' },
    { id: 'C05', text: 'เรียนแต่ละวันไม่เกิน 10 คาบ' },
    { id: 'C06', text: 'ครูไม่สอน 2 กลุ่มชนเวลา' },
    { id: 'C07', text: 'ห้องใช้ได้กลุ่มเดียว วิชาเดียวต่อคาบ' },
    { id: 'C08', text: 'ครูสอนเฉพาะวิชาที่อยู่ใน teach' },
    { id: 'C09', text: 'วิชาทฤษฎีใช้ห้อง Theory / วิชาที่มี practice ใช้ห้อง Theory ไม่ได้' },
    { id: 'C10', text: 'Leader ประชุมอังคาร คาบ 8' },
    { id: 'C11', text: 'มีโฮมรูมอย่างน้อยสัปดาห์ละ 1 ชั่วโมง' },
    { id: 'C12', text: 'วิชากิจกรรม พุธ คาบ 8–9' },
    { id: 'C13', text: 'วิชา 20000/30000 เรียนร่วมกัน 2 กลุ่ม' },
]

const RULES = [
    { id: 'C14', kind: 'hard', text: 'วิชา IOT ต้องใช้ห้อง R6201', note: 'ต้องยืนยันรหัสวิชา IOT (รหัสขัดกันระหว่าง sheet)' },
    { id: 'C15', kind: 'hard', text: 'วิชา Network/Server (31901-2002, 31900-0004) ต้องใช้ห้อง R6203' },
    { id: 'C16', kind: 'hard', text: 'วิชา AI/software (31901-2006, 31901-2009) ต้องใช้ห้อง R6405' },
    { id: 'C17', kind: 'hard', text: 'วิชา Graphic 21901-2010 ต้องใช้ห้อง R6205' },
    { id: 'C18', kind: 'hard', text: 'วิชาภาษาอังกฤษ (เช่น 30000-1202) ต้องใช้ห้อง R5204', note: 'คำว่า "เช่น" ยังไม่ครบ ต้องกำหนดรหัสวิชาให้ครบ' },
    { id: 'C19', kind: 'hard', text: 'โฮมรูมสอนโดยครูที่ปรึกษาของกลุ่ม', pending: true, note: 'ยังไม่มีวิชาโฮมรูมในชุดข้อมูลและยังไม่ได้ map ชื่อ advisor เป็น teacher ID' },
    { id: 'C20', kind: 'soft', text: 'หลีกเลี่ยงวิชาทฤษฎีหลังคาบ 9 (หลัง 17:00)' },
    { id: 'C22', kind: 'soft', text: 'วิชาที่มีทั้งทฤษฎีและปฏิบัติ ควรเรียนทฤษฎีก่อนหรือพร้อมปฏิบัติ', note: 'ความหมายของคำว่า "ก่อน" ยังต้องให้กรรมการยืนยัน' },
    { id: 'C23', kind: 'soft', text: 'ควรเริ่มเรียนคาบ 1 หรือ 2 ในวันที่มีเรียน' },
]

const isFull = () => limitMode.value && model.value.length >= MAX
function onLimitChange() {
    // เปิดโหมดจำกัดตอนเลือกเกิน MAX อยู่: ตัดเหลือ MAX ข้อแรก
    if (limitMode.value && model.value.length > MAX) model.value = model.value.slice(0, MAX)
}
function toggle(id) {
    if (model.value.includes(id)) model.value = model.value.filter((x) => x !== id)
    else if (!isFull()) model.value = [...model.value, id]
}
</script>

<template>
    <section class="mb-4 rounded-lg border border-line bg-white p-5">
        <h2 class="font-semibold">เงื่อนไข</h2>

        <details class="mt-2 rounded border border-line bg-canvas px-3 py-2 text-sm">
            <summary class="cursor-pointer font-medium">เงื่อนไขพื้นฐาน C01–C13 (เปิดเสมอ)</summary>
            <ul class="mt-2 space-y-1 text-muted">
                <li v-for="b in BASE" :key="b.id"><span class="font-medium text-ink">{{ b.id }}</span> {{ b.text }}</li>
            </ul>
        </details>

        <h3 class="mt-4 font-semibold">เงื่อนไขพิเศษ (C14–C23 ไม่มี C21)</h3>
        <label class="mt-2 flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" class="size-4 accent-accent" v-model="limitMode" :disabled="disabled"
                @change="onLimitChange" />
            โหมดแข่งขัน: จำกัดไม่เกิน {{ MAX }} ข้อ (กรรมการสุ่มจับ {{ MAX }} เงื่อนไข)
        </label>
        <p class="mt-1 text-sm text-muted">
            เลือกแล้ว {{ model.length }}<template v-if="limitMode">/{{ MAX }}</template> ·
            ประเภท hard/soft เป็นข้อเสนอของทีม ยังไม่ผ่านการยืนยันจากกรรมการ
        </p>

        <ul class="mt-3 divide-y divide-line">
            <li v-for="r in RULES" :key="r.id">
                <label class="flex cursor-pointer items-start gap-3 py-2"
                    :class="{ 'opacity-50': disabled || (isFull() && !model.includes(r.id)) }">
                    <input type="checkbox" class="mt-1 size-4 accent-accent" :checked="model.includes(r.id)"
                        :disabled="disabled || (isFull() && !model.includes(r.id))" @change="toggle(r.id)" />
                    <span class="flex-1">
                        <span class="font-medium">{{ r.id }}</span> {{ r.text }}
                        <span v-if="r.note" class="block text-xs text-muted">{{ r.note }}</span>
                    </span>
                    <span v-if="r.pending"
                        class="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">รอการตัดสินใจ</span>
                    <span class="rounded px-2 py-0.5 text-xs font-semibold"
                        :class="r.kind === 'hard' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-800'">{{ r.kind
                        }}</span>
                </label>
            </li>
        </ul>
    </section>
</template>