<script setup lang="ts">
defineProps<{ title: string; subtitle: string; value: string; reportHref: string }>();
</script>

<template>
  <section class="stat-card">
    <h3>{{ title }}</h3>
    <p class="stat-subtitle">{{ subtitle }}</p>
    <p class="stat-value">{{ value }}</p>
    <a class="stat-link" :href="reportHref">View report</a>
  </section>
</template>
