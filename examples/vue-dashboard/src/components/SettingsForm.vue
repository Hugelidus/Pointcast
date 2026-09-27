<script setup lang="ts">
import { reactive } from "vue";

/** A password field and a data-sensitive field, neither ever captured (see README, Privacy). */
const form = reactive({ name: "Ana Ríos", email: "ana@example.com", password: "", apiKey: "" });
</script>

<template>
  <form class="settings-form" @submit.prevent>
    <h2>Account</h2>
    <label class="field">
      <span>Full name</span>
      <input type="text" v-model="form.name" />
    </label>
    <label class="field">
      <span>Email</span>
      <input type="email" v-model="form.email" />
    </label>
    <label class="field">
      <span>New password</span>
      <input type="password" autocomplete="new-password" v-model="form.password" />
    </label>
    <label class="field">
      <span>Store API key</span>
      <input type="text" data-sensitive="true" v-model="form.apiKey" />
    </label>
    <button type="submit" class="btn btn-primary">Save changes</button>
  </form>
</template>
