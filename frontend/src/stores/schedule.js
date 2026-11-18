import { defineStore } from 'pinia'
import { getSchedule, errorMessage } from '../api'
import { useWizardStore } from './wizard'

export const useScheduleStore = defineStore('schedule', {
  state: () => ({ schedule: null, loading: false, error: '' }),
  actions: {
    async load() {
      this.loading = true
      this.error = ''
      try {
        const wizard = useWizardStore()
        this.schedule = await getSchedule(wizard.scheduleId || 'latest')
        if (!this.schedule?.events?.length) this.error = 'ยังไม่มีตารางจากข้อมูลที่อัปโหลด'
      } catch (e) {
        this.error = errorMessage(e)
      } finally {
        this.loading = false
      }
    },
  },
})
