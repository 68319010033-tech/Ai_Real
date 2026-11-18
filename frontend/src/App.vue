<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StepSidebar from './components/StepSidebar.vue'
import { STEPS } from './stores/wizard'
import { useAuthStore } from './stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const current = computed(() => STEPS.find((s) => s.path === route.path))
const isPublic = computed(() => !!route.meta.public)

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <RouterView v-if="isPublic" />
  <div v-else class="min-h-screen lg:flex">
    <StepSidebar class="hidden lg:flex" />
    <div class="min-w-0 flex-1">
            <div class="flex justify-end border-b border-line bg-white px-4 py-2 text-sm lg:hidden">  
        <span v-if="auth.user" class="mr-3 text-muted">{{ auth.user.email }}</span>
        <button type="button" class="text-accent" @click="logout">ออกจากระบบ</button>
      </div>
      <header v-if="current" class="bg-side px-4 py-3 text-white lg:hidden">
        <p class="text-sm text-white/70">ขั้นที่ {{ current.n }} จาก {{ STEPS.length }}</p>
        <p class="font-semibold">{{ current.title }}</p>
        <div class="mt-2 h-1 rounded bg-white/20">
          <div class="h-1 rounded bg-accent" :style="{ width: (current.n / STEPS.length) * 100 + '%' }"></div>
        </div>
      </header>
      <main class="mx-auto max-w-6xl p-4 lg:p-10">
        <RouterView />
      </main>
    </div>
  </div>
</template>