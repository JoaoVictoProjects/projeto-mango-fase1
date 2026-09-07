import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function copyClassicAssets() {
  return {
    name: "copy-classic-assets",

    closeBundle() {
      const sourceDirectory = resolve("dist/assets");
      const targetDirectory = resolve("build/assets");

      mkdirSync(targetDirectory, { recursive: true });

      const files = [
        "app.js",
        "d3.min.js",
        "reference.png",
        "territory-mesh.js",
        "world-data.js"
      ];

      for (const file of files) {
        cpSync(
          resolve(sourceDirectory, file),
          resolve(targetDirectory, file)
        );
      }
    }
  };
}

export default defineConfig({
  root: "dist",

  plugins: [
    copyClassicAssets()
  ],

  server: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true
  },

  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true
  },

  build: {
    outDir: "../build",
    emptyOutDir: true
  }
});