import sharp from "sharp";
import pngToIco from "png-to-ico";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("build-assets", { recursive: true });
const sizes = [16, 32, 48, 256];
const pngs = await Promise.all(
  sizes.map((size) =>
    sharp("public/icon.svg").resize(size, size).png().toBuffer(),
  ),
);
await writeFile("build-assets/icon.png", pngs.at(-1));
await writeFile("build-assets/icon.ico", await pngToIco(pngs));
