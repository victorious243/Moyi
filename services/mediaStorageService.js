const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const env = require('../config/env');

let s3Client;

function activeMediaStorageProvider() {
  return env.mediaStorageProvider || 'machine';
}

function createS3Client() {
  if (s3Client) return s3Client;
  if (!(env.s3Bucket && env.s3Region && env.s3AccessKeyId && env.s3SecretAccessKey)) {
    const error = new Error('S3/R2 media storage is not configured. Add the S3 bucket, region, access key, and secret key.');
    error.code = 'media_storage_not_configured';
    error.statusCode = 503;
    throw error;
  }
  s3Client = new S3Client({
    region: env.s3Region,
    endpoint: env.s3Endpoint || undefined,
    forcePathStyle: env.s3ForcePathStyle !== false,
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey
    }
  });
  return s3Client;
}

function validateMediaStorageKey(value) {
  const storageKey = String(value || '');
  if (!/^social-media\/[a-f\d-]{24,36}\/[a-z0-9_-]+\.(?:jpe?g|png|webp|mp4|mov|webm)$/i.test(storageKey)) {
    const error = new Error('Invalid social media storage key.');
    error.code = 'invalid_media_storage_key';
    error.statusCode = 422;
    throw error;
  }
  return storageKey;
}

function mediaStoragePath(storageKey) {
  const validKey = validateMediaStorageKey(storageKey);
  const root = path.resolve(env.mediaStoragePath);
  const target = path.resolve(root, validKey);
  if (!target.startsWith(`${root}${path.sep}`)) {
    const error = new Error('Invalid social media storage path.');
    error.code = 'invalid_media_storage_key';
    throw error;
  }
  return target;
}

async function ensureMediaDirectories() {
  await Promise.all([
    fs.promises.mkdir(env.mediaStoragePath, { recursive: true, mode: 0o700 }),
    fs.promises.mkdir(env.mediaUploadTempPath, { recursive: true, mode: 0o700 })
  ]);
}

async function uploadMediaFile({ filePath, storageKey, mimeType }) {
  const key = validateMediaStorageKey(storageKey);
  if (activeMediaStorageProvider() === 's3') {
    const upload = new Upload({
      client: createS3Client(),
      params: {
        Bucket: env.s3Bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: mimeType,
        CacheControl: 'private, max-age=31536000, immutable'
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false
    });
    await upload.done();
    return key;
  }

  const target = mediaStoragePath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.promises.copyFile(filePath, target);
  await fs.promises.chmod(target, 0o600);
  return key;
}

async function downloadMediaToFile(storageKey, targetPath) {
  const key = validateMediaStorageKey(storageKey);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  if (activeMediaStorageProvider() === 's3') {
    const response = await createS3Client().send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    if (!response.Body) throw new Error('The stored media file was empty.');
    await pipeline(response.Body, fs.createWriteStream(targetPath, { mode: 0o600 }));
    return targetPath;
  }
  await fs.promises.copyFile(mediaStoragePath(key), targetPath);
  await fs.promises.chmod(targetPath, 0o600);
  return targetPath;
}

async function downloadMediaBuffer(storageKey) {
  const key = validateMediaStorageKey(storageKey);
  if (activeMediaStorageProvider() === 's3') {
    const response = await createS3Client().send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    if (!response.Body) throw new Error('The stored media file was empty.');
    return Buffer.from(await response.Body.transformToByteArray());
  }
  return fs.promises.readFile(mediaStoragePath(key));
}

async function openMediaDownloadStream(storageKey, options = {}) {
  const key = validateMediaStorageKey(storageKey);
  if (activeMediaStorageProvider() === 's3') {
    const response = await createS3Client().send(new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      ...(options.range ? { Range: options.range } : {})
    }));
    if (!response.Body) throw new Error('The stored media file was empty.');
    return response.Body;
  }
  return fs.createReadStream(mediaStoragePath(key), {
    ...(Number.isInteger(options.start) ? { start: options.start } : {}),
    ...(Number.isInteger(options.end) ? { end: options.end } : {})
  });
}

async function deleteMediaFile(storageKey) {
  if (!storageKey) return;
  const key = validateMediaStorageKey(storageKey);
  if (activeMediaStorageProvider() === 's3') {
    await createS3Client().send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return;
  }
  await fs.promises.unlink(mediaStoragePath(key)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = {
  activeMediaStorageProvider,
  deleteMediaFile,
  downloadMediaBuffer,
  downloadMediaToFile,
  ensureMediaDirectories,
  mediaStoragePath,
  openMediaDownloadStream,
  uploadMediaFile,
  validateMediaStorageKey
};
