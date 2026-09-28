<script setup lang="ts">
/** Sales per day this week, Monday to Sunday. */
const WEEKLY_SALES = [32, 48, 40, 65, 54, 72, 61];
const CHART_WIDTH = 40;
const CHART_GAP = 14;
const CHART_HEIGHT = 120;
const max = Math.max(...WEEKLY_SALES);
</script>

<template>
  <section class="chart-card">
    <h3>Sales this week</h3>
    <svg
      class="sales-chart"
      :viewBox="`0 0 ${WEEKLY_SALES.length * (CHART_WIDTH + CHART_GAP)} ${CHART_HEIGHT}`"
      role="img"
      aria-label="Bar chart of sales per day this week"
    >
      <rect
        v-for="(value, i) in WEEKLY_SALES"
        :key="i"
        class="chart-bar"
        :x="i * (CHART_WIDTH + CHART_GAP)"
        :y="CHART_HEIGHT - (value / max) * CHART_HEIGHT"
        :width="CHART_WIDTH"
        :height="(value / max) * CHART_HEIGHT"
      />
    </svg>
  </section>
</template>
