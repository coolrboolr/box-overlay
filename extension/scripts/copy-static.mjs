import { cp } from "fs/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";

const dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(dirname, "..");
const staticDir = resolve(root, "static");
const distDir = resolve(root, "dist");
const stylesDir = resolve(root, "src", "styles");

const run = async () => {
  await cp(staticDir, resolve(distDir, "icons"), {
    recursive: true,
    force: true
  });
  await cp(resolve(stylesDir, "overlay.css"), resolve(distDir, "overlay.css"), {
    recursive: false,
    force: true
  });
};

run().catch((error) => {
  console.error("[copy-static]", error);
  process.exitCode = 1;
});
