import { createRouter, createWebHistory } from 'vue-router'
import { STEPS, useWizardStore } from '../stores/wizard'
import UploadView from '../views/UploadView.vue'
import ReviewView from '../views/ReviewView.vue'
import GenerateView from '../views/GenerateView.vue'
import TimetableView from '../views/TimetableView.vue'
import ExportView from '../views/ExportView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/upload' },
    { path: '/upload', component: UploadView },
    { path: '/review', component: ReviewView },
    { path: '/generate', component: GenerateView },
    { path: '/timetable', component: TimetableView },
    { path: '/export', component: ExportView },
    { path: '/login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
    { path: '/register', component: () => import('../views/RegisterView.vue'), meta: { public: true } },
    { path: '/forgot-password', component: () => import('../views/ForgotPasswordView.vue'), meta: { public: true } },
  ],
})

// กันข้ามขั้น (ตั้ง VITE_SKIP_GUARD=true ใน .env เพื่อข้ามตอนพัฒนา)
router.beforeEach((to) => {
  if (import.meta.env.DEV && import.meta.env.VITE_SKIP_GUARD === 'true') return true
  const wizard = useWizardStore()
  const step = STEPS.find((s) => s.path === to.path)
  if (step && !wizard.isUnlocked(step.n)) {
    return STEPS.find((s) => !wizard.isDone(s.n))?.path ?? '/upload'
  }
  return true
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.meta.public && auth.isLoggedIn) return '/upload'
  return true
})

export default router