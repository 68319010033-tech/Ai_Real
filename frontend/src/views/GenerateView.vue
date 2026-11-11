<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { startSolve, getJob, cancelJob, errorMessage } from '../api'
import { useRouter } from 'vue-router'
import { useWizardStore } from '../stores/wizard'
import StepNav from '../components/StepNav.vue'

const router = useRouter()
const wizard = useWizardStore()
const datasetVersion = ref(wizard.importResult?.datasetVersion ?? '')
const timeLimitSeconds = ref(30)
const seed = ref(1)

const job = ref(null) // { jobId, status, solverStatus }
const error = ref('')
const startedAt = ref(0)
const elapsed = ref(0)
let timer = null

const TERMINAL = ['completed', 'failed', 'cancelled']
const STATUS_TEXT = { queued: 'รอคิว', running: 'กำลังคำนวณ', completed: 'เสร็จสิ้น', failed: 'ล้มเหลว', cancelled: 'ยกเลิกแล้ว' }

const running = computed(() => job.value && !TERMINAL.includes(job.value.status))

function stop() {
    clearInterval(timer)
    timer = null
}

async function tick() {
    try {
        const j = await getJob(job.value.jobId)
        job.value = j
        if (TERMINAL.includes(j.status)) {
            stop()
            if (j.status === 'completed' && j.scheduleId && ['OPTIMAL', 'FEASIBLE'].includes(j.solverStatus)) {
                wizard.setSchedule(j.scheduleId)
            }
        } else elapsed.value = (Date.now() - startedAt.value) / 1000
    } catch (e) {
        error.value = errorMessage(e)
        stop()
    }
}

async function start() {
    error.value = ''
    job.value = null
    elapsed.value = 0
    try {
        const { jobId } = await startSolve({
            datasetVersion: datasetVersion.value,
            timeLimitSeconds: Number(timeLimitSeconds.value),
            seed: Number(seed.value),
        })
        job.value = { jobId, status: 'queued', solverStatus: null }
        startedAt.value = Date.now()
        timer = setInterval(tick, 1000)
    } catch (e) {
        error.value = errorMessage(e)
    }
}

async function cancel() {
    try {
        await cancelJob(job.value.jobId)
    } catch (e) {
        error.value = errorMessage(e)
    }
}

onBeforeUnmount(stop)
</script>

<template>
    <h1 class="mb-4 text-2xl font-bold">จัดตารางสอน</h1>

    <section class="mb-4 rounded-md border border-slate-200 bg-white p-4">
        <div class="flex flex-wrap items-end gap-4">
            <label class="flex flex-col text-sm">เวอร์ชันข้อมูล
                <input v-model="datasetVersion" :disabled="running" class="rounded border border-slate-300 px-2 py-1" />
            </label>
            <label class="flex flex-col text-sm">เวลาสูงสุด (วินาที)
                <input v-model="timeLimitSeconds" type="number" min="1" :disabled="running"
                    class="w-32 rounded border border-slate-300 px-2 py-1" />
            </label>
            <label class="flex flex-col text-sm">Seed
                <input v-model="seed" type="number" :disabled="running"
                    class="w-24 rounded border border-slate-300 px-2 py-1" />
            </label>
            <button v-if="!running" :disabled="!datasetVersion" @click="start"
                class="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">เริ่มจัดตาราง</button>
            <button v-else @click="cancel" class="rounded bg-red-700 px-4 py-2 text-white">ยกเลิก</button>
        </div>
        <p v-if="error" class="mt-3 text-red-700" role="alert">{{ error }}</p>
    </section>

    <section v-if="job" class="rounded-md border border-slate-200 bg-white p-4">
        <p>สถานะงาน: <strong>{{ STATUS_TEXT[job.status] ?? job.status }}</strong></p>
        <p v-if="running" class="text-slate-600">เวลาที่ผ่านไป: {{ elapsed.toFixed(0) }} วินาที</p>
        <template v-if="job.status === 'completed'">
            <p>ผลจาก solver: <strong>{{ job.solverStatus }}</strong></p>
            <p v-if="job.solverStatus === 'FEASIBLE'" class="text-slate-600">พบตารางที่ใช้ได้
                แต่ยังไม่พิสูจน์ว่าดีที่สุด</p>
            <p v-if="job.solverStatus === 'UNKNOWN'" class="text-amber-700">ยังหาคำตอบไม่ได้ภายในเวลาที่กำหนด
                (ไม่ได้แปลว่าเป็นไปไม่ได้)</p>
            <p v-if="job.solverStatus === 'INFEASIBLE'" class="text-red-700">solver
                พิสูจน์แล้วว่าไม่มีตารางที่ตรงเงื่อนไขทั้งหมด</p>
              <StepNav back="/review" next-label="ดูตาราง" :next-disabled="!wizard.scheduleId" @next="router.push('/timetable')" />
        </template>
    </section>
</template>