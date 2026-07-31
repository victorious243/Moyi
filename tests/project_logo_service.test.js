const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  parsePng,
  pngHasRealTransparency,
  validateProjectLogoUpload
} = require('../services/projectLogoService');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  return Buffer.concat([
    Buffer.from([(data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff]),
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4)
  ]);
}

function rgbaPng(alpha) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rawScanline = Buffer.from([0, 32, 88, 180, alpha]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(rawScanline)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function uploadFixture(buffer) {
  return {
    buffer,
    mimetype: 'image/png',
    originalname: 'brand-logo.png',
    size: buffer.length
  };
}

test('project logo validation requires a transparent PNG', () => {
  const transparent = rgbaPng(0);
  const opaque = rgbaPng(255);

  assert.equal(parsePng(transparent).colorType, 6);
  assert.equal(pngHasRealTransparency(parsePng(transparent)), true);
  assert.equal(pngHasRealTransparency(parsePng(opaque)), false);
  assert.doesNotThrow(() => validateProjectLogoUpload(uploadFixture(transparent)));
  assert.throws(() => validateProjectLogoUpload(uploadFixture(opaque)), /transparent PNG logo/);
  assert.throws(
    () => validateProjectLogoUpload({ ...uploadFixture(transparent), mimetype: 'image/jpeg' }),
    /must be PNG/
  );
});
