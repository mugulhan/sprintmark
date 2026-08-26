import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(appRoot, "dist", "vendor", "toastui-editor.js");

await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(appRoot, "src", "vendor-entry.mjs")],
  outfile: output,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "eof",
});

console.log(`Vendor bundle hazır: ${output}`);
