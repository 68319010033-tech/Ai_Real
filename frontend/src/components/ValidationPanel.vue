<script setup>
import { onMounted, ref } from 'vue'
import { getValidation, errorMessage } from '../api'

const props = defineProps({ scheduleId: String })
const data = ref(null)
const error = ref('')
const loading = ref(false)
const open = ref(null)

const STATUS = {
  pass: { text: 'ผ่าน', cls: 'bg-green-100 text-green-800' },
  fail: { text: 'ไม่ผ่าน', cls: 'bg-red-100 text-red-800' },
  unresolved: { text: 'รอตัดสินใจนโยบาย', cls: 'bg-amber-100 text-amber-800' },
  inactive: { text: 'ไม่ได้เปิดใช้', cls: 'bg-slate-100 text-slate-600' },
}
const count = (s) => data.value.results.filter((r) => r.status === s).length

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getValidation(props.scheduleId)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="rounded-lg border border-line bg-white p-5">
    <h2 class="text-lg font-semibold">ผลตรวจเงื่อนไข</h2>

    <p v-if="loading" class="mt-2 text-muted">กำลังตรวจตาราง…</p>
    <p v-else-if="error" class="mt-2 text-red-700" role="alert">
      {{ error }} <button class="btn btn-ghost ml-2" @click="load">ลองใหม่</button>
    </p>

    <template v-else-if="data">
      <p class="mt-2 text-sm text-muted">
        ผ่าน {{ count('pass') }} · ไม่ผ่าน {{ count('fail') }} · รอตัดสินใจ {{ count('unresolved') }} · ไม่ได้เปิดใช้ {{ count('inactive') }}
      </p>

      <div class="mt-3 overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-canvas">
            <tr><th class="p-3">รหัส</th><th class="p-3">เงื่อนไข</th><th class="p-3">ผล</th><th class="p-3">จำนวนที่ผิด</th></tr>
          </thead>
          <tbody>
            <template v-for="r in data.results" :key="r.ruleId">
              <tr class="border-t border-line">
                <td class="p-3 font-medium">{{ r.ruleId }}</td>
                <td class="p-3">{{ r.title }}</td>
                <td class="p-3">
                  <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS[r.status]?.cls">{{ STATUS[r.status]?.text ?? r.status }}</span>
                </td>
                <td class="p-3">
                  <button v-if="r.violations.length" class="text-accent underline"
                    :aria-expanded="open === r.ruleId" @click="open = open === r.ruleId ? null : r.ruleId">
                    {{ r.violations.length }} รายการ
                  </button>
                  <span v-else class="text-muted">-</span>
                </td>
              </tr>
              <tr v-if="open === r.ruleId" class="bg-canvas">
                <td colspan="4" class="p-3">
                  <ul class="list-disc pl-5">
                    <li v-for="(v, i) in r.violations" :key="i">
                      {{ v.message }}
                      <span class="text-muted">
                        <template v-if="v.groupIds?.length">· กลุ่ม {{ v.groupIds.join(', ') }}</template>
                        <template v-if="v.teacherId">· ครู {{ v.teacherId }}</template>
                        <template v-if="v.roomId">· ห้อง {{ v.roomId }}</template>
                        <template v-if="v.timeslotId">· คาบ {{ v.timeslotId }}</template>
                      </span>
                    </li>
                  </ul>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>