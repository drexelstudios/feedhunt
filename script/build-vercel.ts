import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, mkdir, writeFile } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

async function buildVercel() {
  // Clean previous output
  await rm(".vercel/output", { recursive: true, force: true });

  // Step 1: Build Vite frontend to .vercel/output/static
  console.log("building client...");
  process.env.VITE_OUTPUT_DIR = ".vercel/output/static";
  await viteBuild({
    build: {
      outDir: resolve(".vercel/output/static"),
    },
  });

  // Step 2: Build API handler to .vercel/output/functions/api/index.func/
  const funcDir = ".vercel/output/functions/api/index.func";
  await mkdir(funcDir, { recursive: true });

  console.log("building api function for Vercel Build Output API...");

  // ── esbuild plugins to fix jsdom when bundled into a single file ────────────
  //
  // jsdom uses __dirname-relative file reads and require.resolve() to locate
  // companion files at runtime. In a single-file bundle, __dirname becomes "/"
  // and require.resolve breaks, causing ENOENT errors in Vercel's /var/task env.
  // We patch each affected file at build time.

  // Plugin 1: xhr-sync-worker
  // jsdom forks a worker for synchronous XHR using require.resolve().
  // We never use sync XHR, so replace with __filename (a harmless no-op).
  const patchXhrWorker = {
    name: "patch-xhr-sync-worker",
    setup(build: any) {
      build.onLoad({ filter: /XMLHttpRequest-impl\.js$/ }, (args: any) => {
        let contents = readFileSync(args.path, "utf8");
        contents = contents.replace(
          /require\.resolve\(['"]\.\/xhr-sync-worker\.js['"]\)/g,
          "__filename"
        );
        return { contents, loader: "js" };
      });
    },
  };

  // Plugin 2: default-stylesheet.css (main jsdom — computed-style.js)
  // Reads CSS via fs.readFileSync(path.resolve(__dirname, "../../../browser/default-stylesheet.css"))
  // We inline the CSS content as a JSON string at build time.
  const patchComputedStyle = {
    name: "patch-computed-style",
    setup(build: any) {
      build.onLoad({ filter: /computed-style\.js$/ }, (args: any) => {
        let contents = readFileSync(args.path, "utf8");
        const cssPath = resolve(dirname(args.path), "../../../browser/default-stylesheet.css");
        if (existsSync(cssPath)) {
          const cssJson = JSON.stringify(readFileSync(cssPath, "utf8"));
          // Replace the multi-line readFileSync block with inlined string
          contents = contents.replace(
            /const defaultStyleSheet = fs\.readFileSync\(\s*path\.resolve\([^)]+\),\s*\{[^}]+\}\s*\);/,
            `const defaultStyleSheet = ${cssJson};`
          );
        }
        return { contents, loader: "js" };
      });
    },
  };

  // Plugin 3: default-stylesheet.css (isomorphic-dompurify's jsdom — style-rules.js)
  // Same problem, different relative path: ../../browser/default-stylesheet.css
  const patchStyleRules = {
    name: "patch-style-rules",
    setup(build: any) {
      build.onLoad({ filter: /style-rules\.js$/ }, (args: any) => {
        let contents = readFileSync(args.path, "utf8");
        const cssPath = resolve(dirname(args.path), "../../browser/default-stylesheet.css");
        if (existsSync(cssPath)) {
          const cssJson = JSON.stringify(readFileSync(cssPath, "utf8"));
          contents = contents.replace(
            /const defaultStyleSheet = fs\.readFileSync\(\s*path\.resolve\([^)]+\),\s*\{[^}]+\}\s*\);/,
            `const defaultStyleSheet = ${cssJson};`
          );
        }
        return { contents, loader: "js" };
      });
    },
  };

  await esbuild({
    entryPoints: ["server/vercel-handler.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: `${funcDir}/index.js`,
    external: [],
    plugins: [patchXhrWorker, patchComputedStyle, patchStyleRules],
    minify: false,
    logLevel: "info",
    loader: { ".node": "file" },
  });

  // Write .vc-config.json for the function
  await writeFile(
    `${funcDir}/.vc-config.json`,
    JSON.stringify({
      runtime: "nodejs20.x",
      handler: "index.js",
      launcherType: "Nodejs",
      maxDuration: 30,
    }, null, 2)
  );

  // Step 3: Write .vercel/output/config.json with routing rules
  const config = {
    version: 3,
    routes: [
      { src: "/api/(.*)", dest: "/api/index" },
      { handle: "filesystem" },
      { src: "/(.*)", dest: "/index.html" },
    ],
  };

  await writeFile(".vercel/output/config.json", JSON.stringify(config, null, 2));

  console.log("Vercel build complete!");
  console.log("  .vercel/output/static/ — frontend");
  console.log("  .vercel/output/functions/api/index.func/ — API serverless function");
  console.log("  .vercel/output/config.json — routing config");
}

buildVercel().catch((err) => {
  console.error(err);
  process.exit(1);
});
