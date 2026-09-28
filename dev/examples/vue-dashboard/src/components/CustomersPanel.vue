<script setup lang="ts">
interface Customer {
  id: string;
  name: string;
  email: string;
}

const CUSTOMERS: Customer[] = [
  { id: "c1", name: "Lina Torres", email: "lina@example.com" },
  { id: "c2", name: "Marco Peña", email: "marco@example.com" },
  { id: "c3", name: "Sofía Ibarra", email: "sofia@example.com" },
];
</script>

<template>
  <section class="panel">
    <div class="panel-toolbar">
      <h2>Customers</h2>
      <button type="button" id="customers-export" class="btn btn-export">Export</button>
    </div>
    <p class="panel-subtitle">Everyone who has placed an order</p>
    <ul class="customer-list">
      <li v-for="customer in CUSTOMERS" :key="customer.id">
        <span class="customer-name">{{ customer.name }}</span>
        <span class="customer-email">{{ customer.email }}</span>
      </li>
    </ul>
  </section>
</template>
