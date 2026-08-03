const zlib = require('zlib');
const {
  deleteFile,
  downloadBuffer,
  activeStorageProvider,
  openDownloadStream,
  uploadBuffer
} = require('./contentImageStorageService');

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function cleanText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function parsePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }

  let offset = 8;
  const chunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;
    if (length < 0 || dataEnd > buffer.length || nextOffset > buffer.length) return null;
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    offset = nextOffset;
    if (type === 'IEND') break;
  }

  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr || ihdr.data.length !== 13) return null;

  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    compression: ihdr.data[10],
    filter: ihdr.data[11],
    interlace: ihdr.data[12],
    chunks
  };
}

function paethPredictor(left, above, upperLeft) {
  const p = left + above - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - above);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return above;
  return upperLeft;
}

function unfilterScanlines(raw, { width, height, bytesPerPixel }) {
  const stride = width * bytesPerPixel;
  const expected = height * (stride + 1);
  if (raw.length < expected) return null;

  const rows = [];
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[offset];
    offset += 1;
    const row = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    const previous = rows[y - 1] || Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x] || 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filterType === 1) row[x] = (row[x] + left) & 0xff;
      else if (filterType === 2) row[x] = (row[x] + above) & 0xff;
      else if (filterType === 3) row[x] = (row[x] + Math.floor((left + above) / 2)) & 0xff;
      else if (filterType === 4) row[x] = (row[x] + paethPredictor(left, above, upperLeft)) & 0xff;
      else if (filterType !== 0) return null;
    }
    rows.push(row);
  }

  return rows;
}

function pngHasRealTransparency(parsed) {
  if (!parsed || parsed.compression !== 0 || parsed.filter !== 0) return false;
  if (parsed.chunks.some((chunk) => chunk.type === 'tRNS')) return true;
  if (parsed.interlace !== 0 || parsed.bitDepth !== 8 || ![4, 6].includes(parsed.colorType)) return false;

  const idat = Buffer.concat(parsed.chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
  if (!idat.length) return false;

  let raw;
  try {
    raw = zlib.inflateSync(idat);
  } catch (error) {
    return false;
  }

  const bytesPerPixel = parsed.colorType === 6 ? 4 : 2;
  const alphaOffset = parsed.colorType === 6 ? 3 : 1;
  const rows = unfilterScanlines(raw, { width: parsed.width, height: parsed.height, bytesPerPixel });
  if (!rows) return false;

  return rows.some((row) => {
    for (let index = alphaOffset; index < row.length; index += bytesPerPixel) {
      if (row[index] < 255) return true;
    }
    return false;
  });
}

function validateProjectLogoUpload(file) {
  if (!file || !file.buffer || !file.size) {
    const error = new Error('Upload a transparent PNG logo before saving.');
    error.statusCode = 422;
    throw error;
  }
  if (file.mimetype !== 'image/png') {
    const error = new Error('Project logos must be PNG files.');
    error.statusCode = 422;
    throw error;
  }
  if (file.size > MAX_LOGO_BYTES) {
    const error = new Error('Project logo uploads must be 2 MB or smaller.');
    error.statusCode = 422;
    throw error;
  }

  const parsed = parsePng(file.buffer);
  if (!parsed) {
    const error = new Error('The uploaded logo is not a valid PNG file.');
    error.statusCode = 422;
    throw error;
  }
  if (!pngHasRealTransparency(parsed)) {
    const error = new Error('Upload a transparent PNG logo with no background.');
    error.statusCode = 422;
    throw error;
  }
}

function hasProjectLogo(project) {
  return Boolean(project && project.brandLogo && project.brandLogo.storageKey);
}

async function saveProjectLogo({ project, file }) {
  validateProjectLogoUpload(file);
  const previousStorageKey = project.brandLogo && project.brandLogo.storageKey;
  const storageKey = await uploadBuffer({ buffer: file.buffer, mimeType: 'image/png' });

  project.brandLogo = {
    storageProvider: activeStorageProvider(),
    storageKey,
    filename: cleanText(file.originalname, 180) || `project-logo-${Date.now()}.png`,
    mimeType: 'image/png',
    byteLength: file.size,
    uploadedAt: new Date()
  };

  try {
    await project.save();
  } catch (error) {
    await deleteFile(storageKey).catch(() => null);
    throw error;
  }

  if (previousStorageKey && previousStorageKey !== storageKey) {
    await deleteFile(previousStorageKey).catch(() => null);
  }

  return project.brandLogo;
}

async function removeProjectLogo(project) {
  const storageKey = project.brandLogo && project.brandLogo.storageKey;
  project.brandLogo = {
    storageProvider: activeStorageProvider(),
    storageKey: '',
    filename: '',
    mimeType: '',
    byteLength: 0,
    uploadedAt: null
  };
  await project.save();
  await deleteFile(storageKey).catch(() => null);
}

async function projectLogoReference(project) {
  if (!hasProjectLogo(project)) return null;
  return {
    storageKey: project.brandLogo.storageKey,
    filename: project.brandLogo.filename || 'brand-logo.png',
    mimeType: 'image/png',
    buffer: await downloadBuffer(project.brandLogo.storageKey)
  };
}

module.exports = {
  MAX_LOGO_BYTES,
  hasProjectLogo,
  openDownloadStream,
  parsePng,
  pngHasRealTransparency,
  projectLogoReference,
  removeProjectLogo,
  saveProjectLogo,
  validateProjectLogoUpload
};
