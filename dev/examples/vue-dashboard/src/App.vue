<script setup lang="ts">
import { ref } from "vue";
import Sidebar from "./components/Sidebar.vue";
import Dashboard from "./pages/Dashboard.vue";
import Settings from "./pages/Settings.vue";
import type { Page } from "./types";

const page = ref<Page>("dashboard");
</script>

<template>
  <div class="app-shell">
    <Sidebar :page="page" @navigate="page = $event" />
    <main class="content">
      <Dashboard v-if="page === 'dashboard'" />
      <Settings v-else />
    </main>
  </div>
</template>
