import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { nhacDevServer } from "./dev-server";

const root = resolve(__dirname);
const worker = "http://127.0.0.1:8787";

export default defineConfig({
	root,
	plugins: [preact(), nhacDevServer()],
	build: {
		outDir: resolve(root, "../public"),
		emptyOutDir: true,
		target: "es2022",
		rollupOptions: {
			input: { app: resolve(root, "index.html"), login: resolve(root, "login.html") },
		},
	},
	// `npm run dev:web` serves the UI with HMR; API, streams and covers go to `wrangler dev`.
	server: {
		proxy: { "/api": worker, "/stream": worker, "/cover": worker, "/lyrics": worker },
	},
	test: { include: ["src/**/*.test.ts"], environment: "node" },
});
