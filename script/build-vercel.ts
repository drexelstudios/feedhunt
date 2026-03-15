import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, mkdir, writeFile, cp } from "fs/promises";
import path from "path";

async function buildVercel() {
  // Clean previous output
  await rm(".vercel/output", { recursive: true, force: true });

  // Step 1: Build Vite frontend to .vercel/output/static
  console.log("building client...");
  process.env.VITE_OUTPUT_DIR = ".vercel/output/static";
  await viteBuild({
    build: {
      outDir: path.resolve(".vercel/output/static"),
    },
  });

  // Step 2: Build API handler to .vercel/output/functions/api/index.func/
  const funcDir = ".vercel/output/functions/api/index.func";
  await mkdir(funcDir, { recursive: true });

  console.log("building api function for Vercel Build Output API...");
  await esbuild({
    entryPoints: ["server/vercel-handler.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: `${funcDir}/index.js`,
    // Externalize jsdom + readability: they are large, rely on native file resolution
    // (xhr-sync-worker.js), and must not be bundled inline.
    // They are available in the Vercel Node.js runtime via node_modules.
    external: ["jsdom", "@mozilla/readability", "isomorphic-dompurify"],
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
      // Include the externalized packages so they're available at runtime
      includeFiles: "node_modules/{jsdom,@mozilla/readability,isomorphic-dompurify}/**",
    }, null, 2)
  );

  // Step 3: Write .vercel/output/config.json with routing rules
  const config = {
    version: 3,
    routes: [
      // API requests go to the serverless function
      {
        src: "/api/(.*)",
        dest: "/api/index",
      },
      // Static file handling
      { handle: "filesystem" },
      // SPA fallback
      {
        src: "/(.*)",
        dest: "/index.html",
      },
    ],
  };

  await writeFile(".vercel/output/config.json", JSON.stringify(config, null, 2));

  console.log("Vercel build complete!");
  console.log("Output structure:");
  console.log("  .vercel/output/static/ — frontend");
  console.log("  .vercel/output/functions/api/index.func/ — API serverless function");
  console.log("  .vercel/output/config.json — routing config");
}

buildVercel().catch((err) => {
  console.error(err);
  process.exit(1);
});
