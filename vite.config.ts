import { defineConfig } from "vite";

export default defineConfig({
    base: "./",                 // important for PLC-hosted static files
    build: {
        target: "es2020",
        sourcemap: false,
        cssCodeSplit: false,
        assetsInlineLimit: 0
    },
    server: {
        host: true
    }
});