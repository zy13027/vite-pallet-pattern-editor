import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import react from "@vitejs/plugin-react"; // <--- 1. IMPORT REACT PLUGIN

export default defineConfig({
    base: "./",
    plugins: [
        react(), // <--- 2. ADD REACT PLUGIN HERE
        // REQUIRED: Polyfills Node.js globals for the Siemens API library
        nodePolyfills({
            include: ['buffer', 'stream', 'util', 'process', 'events', 'path', 'url', 'http', 'https'],
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
    ],
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
                    // Safe check for name property
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
        include: ['@siemens/simatic-s7-webserver-api']
    }
});