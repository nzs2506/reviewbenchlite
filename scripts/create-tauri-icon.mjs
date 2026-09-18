import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const size = 512;
const pixels = Buffer.alloc(size * size * 4);
const radius = 106;
const center = size / 2;

function paint(x, y, r, g, b, a = 255) {
  const offset = (y * size + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dx = Math.max(Math.abs(x - center) - (center - radius), 0);
    const dy = Math.max(Math.abs(y - center) - (center - radius), 0);
    if (dx * dx + dy * dy <= radius * radius) paint(x, y, 17, 22, 31);

    const distance = Math.hypot(x - center, y - center);
    if (distance < 90) paint(x, y, 28, 39, 56);
    if (distance >= 88 && distance < 96) paint(x, y, 238, 244, 255);
    if ((Math.abs(x - center) < 14 && distance < 75) || (Math.abs(y - center) < 14 && distance < 75)) {
      paint(x, y, 75, 145, 255);
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

const rows = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
  const target = y * (size * 4 + 1);
  rows[target] = 0;
  pixels.copy(rows, target + 1, y * size * 4, (y + 1) * size * 4);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;

const output = resolve(import.meta.dirname, '..', 'desktop', 'src-tauri', 'icons', 'icon.png');
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0))
]));
