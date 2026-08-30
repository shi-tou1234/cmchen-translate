'use strict';

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { buildIcon, encodePng, crc32 } = require('#lib/icon.js');

function parseChunks(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG 魔数');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    assert.equal(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), crc, `chunk ${type} CRC 校验`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

test('buildIcon: 生成合法 PNG（64x64，IHDR/IDAT/IEND，CRC 全过）', () => {
  const png = buildIcon(64);
  const chunks = parseChunks(png);
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks[0].data.readUInt32BE(0), 64);
  assert.equal(chunks[0].data.readUInt32BE(4), 64);
  assert.equal(chunks[0].data[8], 8);
  assert.equal(chunks[0].data[9], 6);
  assert.equal(chunks[chunks.length - 1].type, 'IEND');
  assert.ok(chunks.some((c) => c.type === 'IDAT'));
});

test('buildIcon: 像素数据解压后长度正确且不是全透明', () => {
  const size = 32;
  const png = buildIcon(size);
  const idat = parseChunks(png).find((c) => c.type === 'IDAT');
  const raw = zlib.inflateSync(idat.data);
  assert.equal(raw.length, size * (1 + size * 4));
  let opaque = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (raw[y * (1 + size * 4) + 1 + x * 4 + 3] === 255) opaque++;
    }
  }
  assert.ok(opaque > size * size * 0.3, '主体应大部分不透明');
});

test('encodePng: 不同尺寸都能编码', () => {
  for (const size of [16, 48]) {
    const png = buildIcon(size);
    const chunks = parseChunks(png);
    assert.equal(chunks[0].data.readUInt32BE(0), size);
  }
});
