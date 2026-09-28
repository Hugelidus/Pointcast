import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Dev-only example app: bound to 127.0.0.1 like dev/playground/ and the other example, so nothing
// on this machine is reachable from the network (see root package.json's "example:vue" script).
export default defineConfig({
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
  },
});
