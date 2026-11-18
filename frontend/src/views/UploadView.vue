<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { readFiles } from '../lib/parseDataset'
import { useWizardStore } from '../stores/wizard'

const MAX_MB = 20
const router = useRouter()
const wizard = useWizardStore()
const files = ref([])
const error = ref('')
const loading = ref(false)
const dragging = ref(false)

function accept(list) {
    error.value = ''
    const picked = Array.from(list)
    const bad = picked.find((f) => !/\.(csv|xlsx)$/i.test(f.name) || f.size > MAX_MB * 1024 * 1024)
    if (bad) {
        error.value = `ไฟล์ ${bad.name} ไม่ใช่ .csv/.xlsx หรือใหญ่เกิน ${MAX_MB} MB`
        files.value = []
        return
    }
    const exts = new Set(picked.map((f) => f.name.split('.').pop().toLowerCase()))
    if (exts.size > 1) {
        error.value = 'อย่าเลือก CSV กับ XLSX ปนกัน เพราะเป็นคนละชุดข้อมูล ให้เลือกชุดเดียว'
        files.value = []
        return
    }
    files.value = picked
}
const onPick = (e) => accept(e.target.files)
function onDrop(e) {
    dragging.value = false
    accept(e.dataTransfer.files)
}

async function upload() {
    loading.value = true
    error.value = ''
    try {
        const sources = await readFiles(files.value)
        if (!sources.some((s) => s.table)) {
            error.value = 'ไม่พบตารางที่รู้จักในไฟล์นี้ (หัวคอลัมน์ต้องตรงกับ DataIndex)'
            return
        }
        wizard.setSources(sources)
        router.push('/review')
    } catch (e) {
        error.value = 'อ่านไฟล์ไม่สำเร็จ: ' + (e?.message ?? 'ไฟล์เสียหาย')
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <h1 class="text-2xl font-bold">อัปโหลดไฟล์ข้อมูล</h1>
    <p class="mt-1 text-muted">เลือกไฟล์ชุดเดียวกัน (CSV หรือ XLSX) ไม่ควรปนกัน ระบบจะไม่รวมสองชุดให้อัตโนมัติ</p>

    <label
        class="mt-6 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors focus-within:ring-2 focus-within:ring-accent"
        :class="dragging ? 'border-accent bg-accent-soft' : 'border-line bg-white'" @dragover.prevent="dragging = true"
        @dragleave="dragging = false" @drop.prevent="onDrop">
        <span class="text-lg font-semibold">ลากไฟล์มาวางที่นี่</span>
        <span class="text-muted">หรือคลิกเพื่อเลือกไฟล์ (.csv, .xlsx) ไม่เกิน {{ MAX_MB }} MB ต่อไฟล์</span>
        <input type="file" multiple accept=".csv,.xlsx" class="sr-only" @change="onPick" />
    </label>

    <ul v-if="files.length" class="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
        <li v-for="f in files" :key="f.name" class="flex justify-between px-4 py-2 text-sm">
            <span>{{ f.name }}</span>
            <span class="text-muted">{{ (f.size / 1024).toFixed(1) }} KB</span>
        </li>
    </ul>

    <p v-if="error" class="mt-3 text-red-700" role="alert">{{ error }}</p>

    <div class="mt-8 flex justify-end">
        <button class="btn" :disabled="!files.length || loading" @click="upload">
            {{ loading ? 'กำลังอ่านไฟล์…' : 'อ่านไฟล์และตรวจข้อมูล' }}
        </button>
    </div>
</template>