// Generates cover.png (800x534) for gladys-elk-m1: plain Node, no dependency.
// An alarm keypad with a small display, an Ethernet module wired to it, a
// local network, a shield with a padlock and a house on a dark blue gradient
// (no brand logo). Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [16 + 18 * t, 34 + 30 * t, 78 + 50 * t]);
  }
}
const white = [255, 255, 255];
const dark = [16, 24, 48];
const red = [230, 70, 60];
const green = [90, 210, 130];
const amber = [250, 190, 70];
const glass = [140, 200, 240];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const arc = (cx, cy, r, width, from, to, color) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const angle = Math.atan2(y - cy, x - cx);
      if (angle < from || angle > to) continue;
      const a = Math.max(
        0,
        Math.min(1, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5),
      );
      if (a > 0) set(x, y, color, a);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};
const shield = (cx, top, w, h, color) => {
  for (let y = top; y < top + h; y += 1) {
    const t = (y - top) / h;
    const half = t < 0.45 ? w / 2 : (w / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.45) / 0.55) ** 2));
    for (let x = Math.floor(cx - half - 1); x <= cx + half + 1; x += 1) {
      const a = Math.max(0, Math.min(1, half - Math.abs(x - cx) + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

disc(400, 270, 250, white, 0.06);

// Keypad: body, two-line display, three LEDs, 3x4 keys.
box(100, 90, 320, 440, 24, white);
box(122, 112, 298, 186, 10, dark);
box(136, 126, 284, 146, 4, glass);
box(136, 154, 250, 172, 4, glass, 0.6);
disc(150, 210, 8, green);
disc(180, 210, 8, amber);
disc(210, 210, 8, red);
for (let row = 0; row < 4; row += 1) {
  for (let col = 0; col < 3; col += 1) {
    const x = 132 + col * 55;
    const y = 232 + row * 50;
    box(x, y, x + 45, y + 38, 8, dark, 0.85);
  }
}

// The Ethernet module beside it, a cable between them.
line(320, 405, 360, 405, 6, white);
box(358, 370, 450, 440, 10, white);
box(372, 386, 404, 412, 4, dark);
disc(426, 392, 5, green);
disc(426, 414, 5, amber);

// Local network: waves from the module to the shield.
for (const r of [22, 42, 62]) arc(404, 285, r, 9, -0.8, 0.8, white);
disc(404, 285, 7, white);
line(404, 292, 404, 370, 5, white);

// Shield with a padlock.
shield(590, 105, 230, 300, white);
box(550, 245, 630, 315, 10, dark);
arc(590, 245, 26, 12, -Math.PI, 0, dark);
disc(590, 273, 8, white);
line(590, 275, 590, 297, 7, white);

// A small house below the shield.
line(540, 455, 590, 420, 10, white);
line(590, 420, 640, 455, 10, white);
box(550, 452, 630, 500, 6, white);
box(580, 468, 600, 500, 4, dark);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
