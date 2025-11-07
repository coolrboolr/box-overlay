import { cp } from "fs/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";

const dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(dirname, "..");
const staticDir = resolve(root, "static");
const iconsDir = resolve(staticDir, "icons");
const harnessDir = resolve(staticDir, "harness");
const distDir = resolve(root, "dist");
const stylesDir = resolve(root, "src", "styles");

async function copyIfExists(source, target, options = {}) {
  try {
    await cp(source, target, options);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

const run = async () => {
  await copyIfExists(iconsDir, resolve(distDir, "icons"), {
    recursive: true,
    force: true
  });
  await copyIfExists(harnessDir, resolve(distDir, "static", "harness"), {
    recursive: true,
    force: true
  });
  await copyIfExists(resolve(stylesDir, "overlay.css"), resolve(distDir, "overlay.css"), {
    recursive: false,
    force: true
  });
};

run().catch((error) => {
  console.error("[copy-static]", error);
  process.exitCode = 1;
});
