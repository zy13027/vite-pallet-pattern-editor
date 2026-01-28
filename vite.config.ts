import { defineConfig } from "vite";

export default defineConfig({
    base: "./",
    build: {
        // 1. Create the project folder inside dist
        outDir: "dist/pallet_layer_editor",
        emptyOutDir: true,

        target: "es2020",
        sourcemap: false,
        cssCodeSplit: false, // Keeps CSS in one file
        assetsInlineLimit: 0,

        rollupOptions: {
            output: {
                // 2. Force the JavaScript to be named 'main.js' in the root
                entryFileNames: "main.js",
                chunkFileNames: "[name].js",

                // 3. Logic to separate CSS (root) from Images/SVG (assets folder)
                assetFileNames: (assetInfo) => {
                    // If the file is CSS, put it in the root as 'style.css'
                    if (assetInfo.name && assetInfo.name.endsWith('.css')) {
                        return 'style.css';
                    }

                    // All other assets (like your SVG) go into the 'assets' folder
                    return 'assets/[name][extname]';
                },
            },
        },
    },
    server: {
        host: true
    }
});