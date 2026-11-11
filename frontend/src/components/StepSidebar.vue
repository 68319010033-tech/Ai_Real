<script setup>
import { RouterLink, useRoute } from 'vue-router'
import { STEPS, useWizardStore } from '../stores/wizard'

const route = useRoute()
const wizard = useWizardStore()

function state(s) {
  if (route.path === s.path) return 'current'
  if (wizard.isDone(s.n)) return 'done'
  return wizard.isUnlocked(s.n) ? 'open' : 'locked'
}
</script>

<template>
  <aside class="sticky top-0 h-screen w-72 shrink-0 flex-col bg-side px-6 py-8 text-white">
    <div class="mb-10">
      <p class="text-lg font-semibold">AI Timetable</p>
      <p class="text-sm text-white/60">ระบบจัดตารางสอนอัตโนมัติ</p>
    </div>

    <ol>
      <li v-for="(s, i) in STEPS" :key="s.n" class="relative pb-8 last:pb-0">
        <span
          v-if="i < STEPS.length - 1"
          class="absolute left-[15px] top-9 h-[calc(100%-20px)] w-px"
          :class="wizard.isDone(s.n) ? 'bg-accent' : 'bg-white/20'"
        ></span>

        <component
          :is="state(s) === 'locked' ? 'div' : RouterLink"
          v-bind="state(s) === 'locked' ? { 'aria-disabled': 'true' } : { to: s.path }"
          class="flex items-start gap-4 rounded-md"
        >
          <span
            class="grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold"
            :class="{
              'bg-white text-side': state(s) === 'current',
              'bg-accent text-white': state(s) === 'done',
              'border border-white/40 text-white/70': state(s) === 'open',
              'border border-white/20 text-white/35': state(s) === 'locked',
            }"
          >
            <template v-if="state(s) === 'done'">✓</template>
            <template v-else>{{ s.n }}</template>
          </span>
          <span>
            <span class="block font-medium" :class="state(s) === 'locked' ? 'text-white/40' : 'text-white'">{{ s.title }}</span>
            <span class="block text-sm text-white/55">{{ s.hint }}</span>
          </span>
        </component>
      </li>
    </ol>
  </aside>
</template>