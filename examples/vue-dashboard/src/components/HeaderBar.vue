<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <header class="header-bar">
    <h1>{{ title }}</h1>
    <div class="header-actions">
      <span class="header-user">Ana Ríos</span>
    </div>
  </header>
</template>
