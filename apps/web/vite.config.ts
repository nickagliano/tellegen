import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const configDir = fileURLToPath(new URL('.', import.meta.url));
const workspace = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

// In `vite dev`, resolve the workspace packages to their source so edits under
// packages/svelte and packages/webmcp hot-reload without `npm run build:*`.
// Builds keep the published `dist` entrypoints so the demo exercises exactly
// what ships. The engine stays on `dist` in both modes: it wraps the wasm
// bundles, which are a separate build step either way.
// Anchored so any other subpath keeps resolving through the package `exports`.
const sourceAliases = [
	{ find: /^@tellegen\/svelte$/, replacement: workspace('packages/svelte/src/lib/index.ts') },
	{
		find: /^@tellegen\/svelte\/styles\.css$/,
		replacement: workspace('packages/svelte/src/lib/styles.css')
	},
	{ find: /^@tellegen\/webmcp$/, replacement: workspace('packages/webmcp/src/index.ts') }
];

export default defineConfig(({ command }) => ({
	resolve: {
		alias: command === 'serve' ? sourceAliases : []
	},
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({ fallback: '200.html', precompress: true }),
			// The policy travels with the build. `deploy/Caddyfile` is a sample that
			// CI never copies, so a policy that lives only there protects nothing.
			// Hash mode works with a prerendered static build: kit hashes its own
			// inline bootstrap, so `script-src` needs no `unsafe-inline`.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'base-uri': ['self'],
					'object-src': ['none'],
					'frame-ancestors': ['none'],
					'form-action': ['self'],
					// The engine is wasm, which needs `wasm-unsafe-eval`. That allows
					// wasm compilation only. Never widen it to `unsafe-eval`.
					'script-src': ['self', 'wasm-unsafe-eval', 'https://cloud.umami.is'],
					// Svelte and maplibre both write inline style attributes.
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:', 'https://*.cartocdn.com'],
					'connect-src': ['self', 'https://*.cartocdn.com', 'https://gateway.umami.is'],
					// The engine worker and maplibre's workers load from blob URLs.
					'worker-src': ['self', 'blob:'],
					'child-src': ['self', 'blob:'],
					'font-src': ['self'],
					'upgrade-insecure-requests': true
				}
			}
		})
	],
	build: {
		// The map is loaded on the client only, but deck.gl/luma.gl are a large
		// coupled WebGL stack. Keep them together so Rolldown does not split
		// circular luma.gl modules across chunks, and set the warning threshold
		// for this known async vendor chunk.
		chunkSizeWarningLimit: 1200,
		rolldownOptions: {
			output: {
				// Kit 3 sets its own codeSplitting groups, which disables manualChunks.
				codeSplitting: {
					groups: [
						{ name: 'deck-vendor', test: /\/node_modules\/@(deck|luma|math|probe)\.gl\// },
						{ name: 'map-vendor', test: /\/node_modules\/maplibre-gl\// }
					]
				}
			}
		}
	},
	server: {
		fs: {
			allow: [searchForWorkspaceRoot(configDir)]
		},
		proxy: {
			'/api': process.env.TELLEGEN_API_ORIGIN ?? 'http://localhost:8000'
		}
	}
}));
