import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the pointcast monorepo but is not part of its workspace: without this,
  // Turbopack takes the repository's pnpm-lock.yaml for the project root.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into this folder.
  agentRules: false,
};

export default nextConfig;
