<script setup>
const model = defineModel({ type: Array, default: () => [] })
defineProps({ disabled: Boolean })

const MAX = 2 // วันแข่งสุ่มจับ 2 เงื่อนไข
const RULES = [
  { id: 'C14', kind: 'hard', text: 'วิชา IOT ต้องใช้ห้อง R6201' },
  { id: 'C15', kind: 'hard', text: 'วิชา Network/Server (31901-2002, 31900-0004) ต้องใช้ห้อง R6203' },
  { id: 'C16', kind: 'hard', text: 'วิชา AI/software (31901-2006, 31901-2009) ต้องใช้ห้อง R6405' },
  { id: 'C17', kind: 'hard', text: 'วิชา Graphic 21901-2010 ต้องใช้ห้อง R6205' },
  { id: 'C18', kind: 'hard', text: 'วิชาภาษาอังกฤษ (เช่น 30000-1202) ต้องใช้ห้อง R5204' },
  { id: 'C19', kind: 'hard', text: 'โฮมรูมสอนโดยครูที่ปรึกษาของกลุ่ม' },
  { id: 'C20', kind: 'soft', text: 'หลีกเลี่ยงวิชาทฤษฎีหลังคาบ 9 (หลัง 17:00)' },
  { id: 'C22', kind: 'soft', text: 'วิชาที่มีทั้งทฤษฎีและปฏิบัติ ควรเรียนทฤษฎีก่อนหรือพร้อมปฏิบัติ' },
  { id: 'C23', kind: 'soft', text: 'ควรเริ่มเรียนคาบ 1 หรือ 2 ในวันที่มีเรียน' },
]

const isFull = () => model.value.length >= MAX
function toggle(id) {
  if (model.value.includes(id)) model.value = model.value.filter((x) => x !== id)
  else if (!isFull()) model.value = [...model.value, id]
}
</script>

<template>
  <section class="mb-4 rounded-lg border border-line bg-white p-5">
    <h2 class="font-semibold">เงื่อนไขพิเศษ</h2>
    <p class="mt-1 text-sm text-muted">
      วันแข่งจริงกรรมการจะสุ่มจับ {{ MAX }} เงื่อนไข เลือกได้ไม่เกิน {{ MAX }} ข้อ
      (เลือกแล้ว {{ model.length }}/{{ MAX }}) · ประเภท hard/soft เป็นข้อเสนอของทีม ยังไม่ผ่านการยืนยันจากกรรมการ
    </p>

    <ul class="mt-3 divide-y divide-line">
      <li v-for="r in RULES" :key="r.id">
        <label class="flex cursor-pointer items-start gap-3 py-2" :class="{ 'opacity-50': disabled || (isFull() && !model.includes(r.id)) }">
          <input type="checkbox" class="mt-1 size-4 accent-accent"
            :checked="model.includes(r.id)"
            :disabled="disabled || (isFull() && !model.includes(r.id))"
            @change="toggle(r.id)" />
          <span class="flex-1">
            <span class="font-medium">{{ r.id }}</span> {{ r.text }}
          </span>
          <span class="rounded px-2 py-0.5 text-xs font-semibold"
            :class="r.kind === 'hard' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-800'">{{ r.kind }}</span>
        </label>
      </li>
    </ul>
  </section>
</template>