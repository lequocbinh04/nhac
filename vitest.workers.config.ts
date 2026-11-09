// Worker integration tests: run test/**/*.test.ts inside workerd via Miniflare, using the same
// bindings as wrangler.example.jsonc (local R2 bucket, simulated rate limiter, static assets).
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.example.jsonc" },
			miniflare: {
				// Test-only secrets; the real ones come from `wrangler secret put`.
				bindings: {
					APP_PASSWORD: "correct horse battery staple",
					SESSION_SECRET: "test-session-secret-0123456789abcdef",
				},
			},
		}),
	],
	test: { include: ["test/**/*.test.ts"] },
});
