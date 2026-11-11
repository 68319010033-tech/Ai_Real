<script setup>
// ช่องกรอกแบบมีไอคอน ทรงมน (ตามดีไซน์ใหม่) ใช้ v-model ได้เลย
defineProps({
  id: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, default: 'text' },
  autocomplete: { type: String, default: 'off' },
  icon: { type: String, default: 'mail' }, // 'mail' | 'lock'
})
const model = defineModel({ type: String, default: '' })
</script>

<template>
  <div>
    <label :for="id" class="mb-1.5 block text-sm font-medium text-ink">{{ label }}</label>
    <div
      class="flex h-12 items-center gap-3 overflow-hidden rounded-full border border-line bg-white pl-5 pr-4 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft"
    >
      <svg v-if="icon === 'mail'" class="h-4 w-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
      <svg v-else class="h-4 w-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <input
        :id="id"
        v-model="model"
        :type="type"
        :autocomplete="autocomplete"
        class="auth-input h-full w-full bg-transparent text-sm text-ink outline-none focus:outline-none! focus-visible:outline-none! placeholder:text-muted/70"
      />
    </div>
  </div>
</template>

<style scoped>
/* พื้นหลัง autofill ของ Chrome/Edge: ทำให้กลืนกับช่องสีขาว ไม่เป็นสี่เหลี่ยมสีฟ้า */
.auth-input:-webkit-autofill,
.auth-input:-webkit-autofill:hover,
.auth-input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px #fff inset;
  -webkit-text-fill-color: var(--color-ink);
  caret-color: var(--color-ink);
  transition: background-color 9999s ease-in-out 0s;
}
</style>