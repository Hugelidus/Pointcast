<script setup lang="ts">
import HeaderBar from "../components/HeaderBar.vue";
import OrdersTable from "../components/OrdersTable.vue";
import SalesChart from "../components/SalesChart.vue";
import StatCard from "../components/StatCard.vue";
</script>

<template>
  <div class="page">
    <HeaderBar title="Dashboard" />
    <div class="stat-grid">
      <StatCard title="Revenue" subtitle="Last 30 days" value="$12,340" report-href="/reports/revenue" />
      <StatCard title="Orders" subtitle="Last 30 days" value="128" report-href="/reports/orders" />
    </div>
    <SalesChart />
    <OrdersTable />
  </div>
</template>
