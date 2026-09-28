import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-only example app: bound to 127.0.0.1 like dev/playground/ and the other example, so nothing
// on this machine is reachable from the network (see root package.json's "example:react" script).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
});
