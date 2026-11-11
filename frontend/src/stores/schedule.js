import { defineStore } from 'pinia'
import { getSchedule, errorMessage } from '../api'

export const useScheduleStore = defineStore('schedule', {
  state: () => ({ schedule: null, loading: false, error: '' }),
  actions: {
    async load() {
      this.loading = true
      this.error = ''
      try {
        this.schedule = await getSchedule()
      } catch (e) {
        this.error = errorMessage(e)
      } finally {
        this.loading = false
      }
    },
  },
})
