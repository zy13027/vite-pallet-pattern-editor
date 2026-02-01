import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    base: "./",
    plugins: [
        react(),
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
            // FIX: Use path.resolve to point exactly to the file shown in your screenshot.
            // Structure: node_modules/lucide/dist/esm/lucide/src/lucide.js
            "lucide": path.resolve(__dirname, "node_modules/lucide/dist/esm/lucide/src/lucide.js"),
        },
    },
    build: {
        outDir: "dist/pallet_layer_editor",
        emptyOutDir: true,
        target: "es2020",
        sourcemap: false,
        cssCodeSplit: false,
        assetsInlineLimit: 0,
        rollupOptions: {
            output: {
                entryFileNames: "main.js",
                chunkFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name && assetInfo.name.endsWith('.css')) {
                        return 'style.css';
                    }
                    return 'assets/[name][extname]';
                },
            },
        },
        commonjsOptions: {
            include: [/lucide/, /node_modules/],
        }
    },
    server: {
        host: true
    },
    optimizeDeps: {
        include: ['@siemens/simatic-s7-webserver-api', 'lucide']
    }
});