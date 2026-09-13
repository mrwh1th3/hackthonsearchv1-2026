/** Rebuild favicon/PWA assets from the same Inspector star used by Logo. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "public/inspector-star.svg"), "utf8");
const paths = source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
function svg(scale = 1, background = "#ffffff") {
  const inset = (32 - 32 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" color="#44423e"><rect width="32" height="32" fill="${background}"/><g transform="translate(${inset} ${inset}) scale(${scale})">${paths}</g></svg>\n`;
}
async function png(destination, size, scale = .86, background = "#ffffff") {
  await sharp(Buffer.from(svg(scale, background))).resize(size, size).png().toFile(path.join(root, destination));
}
await mkdir(path.join(root, "public/icons"), { recursive: true });
await writeFile(path.join(root, "app/icon.svg"), svg());
for (const size of [192, 512]) await png(`public/icons/inspector-${size}.png`, size);
await png("public/icons/inspector-maskable-512.png", 512, .62, "#edf2e8");
await png("app/apple-icon.png", 180, .76);
await png("public/apple-touch-icon.png", 180, .76);
await png("public/inspector-logo.png", 512);

// ICO supports embedded PNG entries, retaining sharp edges at each favicon size.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => sharp(Buffer.from(svg())).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((bytes, index) => {
  const base = 6 + index * 16;
  header[base] = sizes[index];
  header[base + 1] = sizes[index];
  header.writeUInt16LE(1, base + 4);
  header.writeUInt16LE(32, base + 6);
  header.writeUInt32LE(bytes.length, base + 8);
  header.writeUInt32LE(offset, base + 12);
  offset += bytes.length;
});
await writeFile(path.join(root, "app/favicon.ico"), Buffer.concat([header, ...images]));
console.log("Inspector SVG, favicon, Apple and PWA icons generated.");
