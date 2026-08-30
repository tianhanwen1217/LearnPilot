import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(resolve(root, "public"), outdir, { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  minify: false,
  target: "chrome120",
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

await Promise.all([
  build({
    ...common,
    entryPoints: [resolve(root, "src/background/index.ts")],
    outfile: resolve(outdir, "background.js"),
    format: "esm",
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "src/content/index.tsx")],
    outfile: resolve(outdir, "content.js"),
    format: "iife",
    loader: { ".css": "text" },
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "src/options/index.tsx")],
    outfile: resolve(outdir, "options.js"),
    format: "iife",
    loader: { ".css": "text" },
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "src/popup/index.tsx")],
    outfile: resolve(outdir, "popup.js"),
    format: "iife",
    loader: { ".css": "text" },
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "src/demo/index.tsx")],
    outfile: resolve(outdir, "demo.js"),
    format: "iife",
    loader: { ".css": "text" },
  }),
]);

console.log(`Built extension at ${outdir}`);
