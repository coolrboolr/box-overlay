import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";

const staticDir = resolve(new URL("..", import.meta.url).pathname, "static");
const iconsDir = resolve(staticDir, "icons");

const icons = [
  {
    size: 16,
    data: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR4nGM0qfj2n4ECwESJ5lEDIICJgULANGoAw6gBDJQbAADrtALBx+kaeQAAAABJRU5ErkJggg=="
  },
  {
    size: 48,
    data: "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAaElEQVR4nNXOURUAEADAwFkjKZTTmRA+vF2CG3PtQ5jESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZy/A68uuAICY35dFgEAAAAASUVORK5CYII="
  },
  {
    size: 128,
    data: "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABUElEQVR4nO3SQQEAEADAQASRRP9axPDYXYI9Nvc+d5C1fgfwlwHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxDxSNAnc/w6R8AAAAAElFTkSuQmCC"
  }
];

const run = async () => {
  await mkdir(iconsDir, { recursive: true });
  await Promise.all(
    icons.map(async ({ size, data }) => {
      const buffer = Buffer.from(data, "base64");
      const file = resolve(iconsDir, `icon-${size}.png`);
      await writeFile(file, buffer);
    })
  );
};

run().catch((error) => {
  console.error("[generate-icons]", error);
  process.exitCode = 1;
});
