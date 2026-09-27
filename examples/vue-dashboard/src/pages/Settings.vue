<script setup lang="ts">
import CustomersPanel from "../components/CustomersPanel.vue";
import HeaderBar from "../components/HeaderBar.vue";
import SettingsForm from "../components/SettingsForm.vue";
</script>

<template>
  <div class="page">
    <HeaderBar title="Settings" />
    <SettingsForm />
    <CustomersPanel />
  </div>
</template>
