<script setup>
const links = [
  { to: '/timetable', label: 'ตารางสอน' },
  { to: '/import', label: 'นำเข้าข้อมูล' },
  { to: '/generate', label: 'จัดตาราง' },
]
</script>

<template>
  <header class="topbar">
    <strong>AI Timetable</strong>
    <nav>
      <RouterLink v-for="l in links" :key="l.to" :to="l.to">{{ l.label }}</RouterLink>
    </nav>
  </header>
  <main class="page"><RouterView /></main>
</template>
