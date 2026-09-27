<script setup lang="ts">
import { NAV_ITEMS } from "../data/nav";
import type { Page } from "../types";

defineProps<{ page: Page }>();
const emit = defineEmits<{ navigate: [page: Page] }>();
</script>

<template>
  <!-- Built entirely from data/nav.ts: change the badge count or add an item there, not here. -->
  <nav class="sidebar" aria-label="Main">
    <div class="sidebar-brand">Acme Store</div>
    <ul class="nav-list">
      <li v-for="item in NAV_ITEMS" :key="item.id">
        <a
          :href="item.href"
          class="nav-item"
          :class="{ 'nav-item-active': item.page === page }"
          @click.prevent="item.page && emit('navigate', item.page)"
        >
          <span>{{ item.label }}</span>
          <span v-if="item.badge !== undefined" class="badge">{{ item.badge }}</span>
        </a>
      </li>
    </ul>
  </nav>
</template>
