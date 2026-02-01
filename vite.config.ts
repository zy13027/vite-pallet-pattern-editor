import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

export default defineConfig({
    base: "./", // Ensures relative paths for PLC web server
    plugins: [
        // React plugin removed
        nodePolyfills({
            include: ['buffer', 'stream', 'util', 'process', 'events', 'path', 'url', 'http', 'https'],
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
    ],
    resolve: {
        alias: {
            // Point to the ESM build of lucide for tree-shaking
            "lucide": path.resolve(__dirname, "node_modules/lucide/dist/esm/lucide/src/lucide.js"),
        },
    },
    build: {
        outDir: "dist/pallet_layer_editor",
        emptyOutDir: true,
        target: "es2020",
        sourcemap: false,
        assetsInlineLimit: 0, // Forces assets to be separate files
        rollupOptions: {
            output: {
                entryFileNames: "main.js",
                chunkFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    // Keep CSS name simple
                    if (assetInfo.name && assetInfo.name.endsWith('.css')) {
                        return 'style.css';
                    }
                    return 'assets/[name][extname]';
                },
            },
        },
    },
    server: {
        host: true
    },
    optimizeDeps: {
        include: ['@siemens/simatic-s7-webserver-api', 'lucide']
    }
});