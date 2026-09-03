import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isMuncher = mode === "isMuncher";
  return {
    plugins: [react()],
    server: {
      port: 5174, // Unique port for new_project
      strictPort: true,
      host: true,
      cors: true,
      origin: "http://localhost:8000",
      proxy: {
        "/api": {
          target: "http://127.0.0.1:19119", // Backend server
          changeOrigin: true, // Ensure the request appears to come from the frontend server
        },
      },
    },
    build: isMuncher
      ? {
          outDir: "src/components/obsMuncher/munchersPackageExport",
          emptyOutDir: true,
          sourcemap: true,

          rollupOptions: {
            external: [
              "react",
              "react-dom",
              "react-router-dom",
              "pankosmia-rcl",
              "notistack",
            ],
            output: {
              name: "obsMunchersRcl",
              globals: {
                react: "React",
                "react-dom": "ReactDOM",
                "react-router-dom": "ReactRouterDOM",
                "pankosmia-rcl": "pankosmiaRcl",
                notistack: "notistack",
              },
            },
          },

          lib: {
            entry: path.resolve(
              __dirname,
              "./src/components/obsMuncher/muncher/index.js",
            ),
            name: "pankosmiaRcl",
            fileName: (format) => `obs-muncher-rcl.${format}.js`,
          },
        }
      : {
          outDir: "build",
          emptyOutDir: true,
          sourcemap: true,
        },
    base: "/clients/core-contenthandler_obs/",
  };
});
