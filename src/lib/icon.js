'use strict';

// 运行时生成托盘/窗口图标（PNG），不引入任何图片资源依赖。
// 画一个圆角深蓝方块 + 白色「文本行」，随窗口大小缩放。

const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// rgba: Uint8Array 长度 = width*height*4
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy ? rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
              : raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// 圆角方块内画三条白色文本线
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // 圆角半径
  const pad = size * 0.06;
  const lines = [
    { y: 0.34, x0: 0.24, x1: 0.76, w: 0.075 },
    { y: 0.5, x0: 0.24, x1: 0.68, w: 0.075 },
    { y: 0.66, x0: 0.24, x1: 0.56, w: 0.075 }
  ];
  const inRoundedRect = (x, y) => {
    if (x < pad || y < pad || x > size - 1 - pad || y > size - 1 - pad) return false;
    const cx = Math.max(pad + r, Math.min(x, size - 1 - pad - r));
    const cy = Math.max(pad + r, Math.min(y, size - 1 - pad - r));
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r || (x >= pad + r && x <= size - 1 - pad - r) || (y >= pad + r && y <= size - 1 - pad - r);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (inRoundedRect(x, y)) {
        rgba[i] = 0x25;
        rgba[i + 1] = 0x63;
        rgba[i + 2] = 0xeb;
        rgba[i + 3] = 255;
      }
      let white = false;
      for (const L of lines) {
        if (Math.abs(y - L.y * size) <= (L.w * size) / 2 && x >= L.x0 * size && x <= L.x1 * size) white = true;
      }
      if (white) {
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
      }
    }
  }
  return encodePng(size, size, rgba);
}

module.exports = { buildIcon: drawIcon, encodePng, crc32 };
