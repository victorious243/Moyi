const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

const STORAGE_PROVIDER = 'machine';
const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

function storageRoot() {
  return env.contentImageStoragePath;
}

function validateStorageKey(storageKey) {
  const key = String(storageKey || '');
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(key)) {
    const error = new Error('Invalid content image storage key.');
    error.statusCode = 422;
    throw error;
  }
  return key;
}

function filePath(storageKey) {
  return path.join(storageRoot(), validateStorageKey(storageKey));
}

async function ensureStorageDirectory() {
  await fs.promises.mkdir(storageRoot(), { recursive: true, mode: 0o700 });
}

async function uploadBuffer({ buffer, mimeType }) {
  const extension = EXTENSIONS[mimeType];
  if (!extension) throw new Error('Unsupported content image format.');
  await ensureStorageDirectory();

  const storageKey = `${crypto.randomUUID()}${extension}`;
  await fs.promises.writeFile(filePath(storageKey), buffer, {
    flag: 'wx',
    mode: 0o600
  });
  return storageKey;
}

async function downloadBuffer(storageKey) {
  return fs.promises.readFile(filePath(storageKey));
}

async function deleteFile(storageKey) {
  if (!storageKey) return;
  try {
    await fs.promises.unlink(filePath(storageKey));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function openDownloadStream(storageKey) {
  return fs.createReadStream(filePath(storageKey));
}

module.exports = {
  STORAGE_PROVIDER,
  deleteFile,
  downloadBuffer,
  ensureStorageDirectory,
  openDownloadStream,
  storageRoot,
  uploadBuffer,
  validateStorageKey
};
