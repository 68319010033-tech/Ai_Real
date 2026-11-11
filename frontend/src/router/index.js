import { createRouter, createWebHistory } from 'vue-router'
import ImportView from '../views/ImportView.vue'
import TimetableView from '../views/TimetableView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/timetable' },
    { path: '/timetable', name: 'timetable', component: TimetableView },
    { path: '/import', name: 'import', component: ImportView },
  ],
})
