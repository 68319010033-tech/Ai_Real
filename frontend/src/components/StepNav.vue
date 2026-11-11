<script setup>
defineProps({ back: String, nextLabel: String, nextDisabled: Boolean })
defineEmits(['next'])
</script>

<template>
  <div class="mt-8 flex items-center justify-between">
    <RouterLink v-if="back" :to="back" class="btn btn-ghost">ย้อนกลับ</RouterLink>
    <span v-else></span>
    <button v-if="nextLabel" class="btn" :disabled="nextDisabled" @click="$emit('next')">{{ nextLabel }}</button>
  </div>
</template>