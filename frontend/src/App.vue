<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import StepSidebar from './components/StepSidebar.vue'
import { STEPS } from './stores/wizard'

const route = useRoute()
const current = computed(() => STEPS.find((s) => s.path === route.path))
</script>

<template>
  <div class="min-h-screen lg:flex">
    <StepSidebar class="hidden lg:flex" />
    <div class="min-w-0 flex-1">
      <header v-if="current" class="bg-side px-4 py-3 text-white lg:hidden">
        <p class="text-sm text-white/70">ขั้นที่ {{ current.n }} จาก {{ STEPS.length }}</p>
        <p class="font-semibold">{{ current.title }}</p>
        <div class="mt-2 h-1 rounded bg-white/20">
          <div class="h-1 rounded bg-accent" :style="{ width: (current.n / STEPS.length) * 100 + '%' }"></div>
        </div>
      </header>
      <main class="mx-auto max-w-6xl p-4 lg:p-10"><RouterView /></main>
    </div>
  </div>
</template>