import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { fileURLToPath } from "node:url";

const tslibESModule = fileURLToPath(new URL("./node_modules/tslib/tslib.es6.mjs", import.meta.url));

export default defineWorkersConfig({
	resolve: {
		alias: {
			tslib: tslibESModule,
		},
	},
	test: {
		setupFiles: ["./test/setup.js"],
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
			},
		},
	},
});
