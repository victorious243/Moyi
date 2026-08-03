const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { PassThrough } = require('stream');
const env = require('../config/env');

const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

function activeStorageProvider() {
  return env.contentImageStorageProvider || 'machine';
}

const STORAGE_PROVIDER = activeStorageProvider();

function storageRoot() {
  return env.contentImageStoragePath;
}

function s3Config() {
  return {
    bucket: env.s3Bucket,
    region: env.s3Region || 'eu-west-1',
    endpoint: env.s3Endpoint || '',
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
    forcePathStyle: env.s3ForcePathStyle !== false
  };
}

function storageAccessError(error) {
  if (!['EACCES', 'EPERM', 'EROFS'].includes(error && error.code)) {
    return error;
  }

  const wrapped = new Error(
    `Content image storage is not writable at ${storageRoot()}. Set CONTENT_IMAGE_STORAGE_PATH to a persistent writable directory such as /var/lib/moyi/content-images and make sure the Moyi service user owns it.`
  );
  wrapped.statusCode = 500;
  wrapped.cause = error;
  return wrapped;
}

function validateStorageKey(storageKey) {
  const key = String(storageKey || '');
  if (!/^(?:[a-z0-9-]+\/)*[a-f0-9-]{36}\.(jpg|png|webp)$/.test(key)) {
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
  if (activeStorageProvider() === 's3') return;
  try {
    await fs.promises.mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  } catch (error) {
    throw storageAccessError(error);
  }
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value).digest(encoding);
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function dateStamp(amzDateValue) {
  return amzDateValue.slice(0, 8);
}

function s3HostAndPath(storageKey) {
  const config = s3Config();
  const endpoint = config.endpoint
    ? new URL(config.endpoint)
    : new URL(`https://s3.${config.region}.amazonaws.com`);
  const key = validateStorageKey(storageKey);

  if (config.forcePathStyle) {
    return {
      protocol: endpoint.protocol,
      host: endpoint.host,
      path: `/${encodeURIComponent(config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
    };
  }

  return {
    protocol: endpoint.protocol,
    host: `${config.bucket}.${endpoint.host}`,
    path: `/${key.split('/').map(encodeURIComponent).join('/')}`
  };
}

function s3SigningKey(secretAccessKey, date, region) {
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

function signedS3RequestOptions({ method, storageKey, body = Buffer.alloc(0), headers = {} }) {
  const config = s3Config();
  if (!(config.bucket && config.region && config.accessKeyId && config.secretAccessKey)) {
    const error = new Error('S3 storage is not configured. Add S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.');
    error.statusCode = 503;
    throw error;
  }

  const target = s3HostAndPath(storageKey);
  const now = amzDate();
  const today = dateStamp(now);
  const payloadHash = sha256(body);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = `host:${target.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${now}\n`;
  const canonicalRequest = [
    method,
    target.path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${today}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    now,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const signature = hmac(s3SigningKey(config.secretAccessKey, today, config.region), stringToSign, 'hex');

  return {
    method,
    protocol: target.protocol,
    host: target.host,
    path: target.path,
    headers: {
      ...headers,
      Host: target.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': now,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
}

function s3Request({ method, storageKey, body = Buffer.alloc(0), headers = {} }) {
  return new Promise((resolve, reject) => {
    const options = signedS3RequestOptions({ method, storageKey, body, headers });
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseBody);
          return;
        }
        const error = new Error(`S3 ${method} ${storageKey} failed with status ${res.statusCode}.`);
        error.statusCode = res.statusCode;
        error.responseBody = responseBody.toString('utf8').slice(0, 1000);
        reject(error);
      });
    });

    req.on('error', reject);
    if (body.length) req.write(body);
    req.end();
  });
}

async function uploadBuffer({ buffer, mimeType }) {
  const extension = EXTENSIONS[mimeType];
  if (!extension) throw new Error('Unsupported content image format.');
  const storageKey = `${activeStorageProvider() === 's3' ? 'content-images/' : ''}${crypto.randomUUID()}${extension}`;
  if (activeStorageProvider() === 's3') {
    await s3Request({
      method: 'PUT',
      storageKey,
      body: buffer,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length)
      }
    });
    return storageKey;
  }

  await ensureStorageDirectory();
  try {
    await fs.promises.writeFile(filePath(storageKey), buffer, {
      flag: 'wx',
      mode: 0o600
    });
  } catch (error) {
    throw storageAccessError(error);
  }
  return storageKey;
}

async function downloadBuffer(storageKey) {
  if (activeStorageProvider() === 's3') {
    return s3Request({ method: 'GET', storageKey });
  }

  try {
    return await fs.promises.readFile(filePath(storageKey));
  } catch (error) {
    throw storageAccessError(error);
  }
}

async function deleteFile(storageKey) {
  if (!storageKey) return;
  if (activeStorageProvider() === 's3') {
    await s3Request({ method: 'DELETE', storageKey });
    return;
  }

  try {
    await fs.promises.unlink(filePath(storageKey));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function openDownloadStream(storageKey) {
  if (activeStorageProvider() === 's3') {
    const stream = new PassThrough();
    s3Request({ method: 'GET', storageKey })
      .then((buffer) => stream.end(buffer))
      .catch((error) => stream.destroy(error));
    return stream;
  }

  const stream = fs.createReadStream(filePath(storageKey));
  stream.on('error', (error) => {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error && error.code)) {
      stream.destroy(storageAccessError(error));
    }
  });
  return stream;
}

module.exports = {
  STORAGE_PROVIDER,
  activeStorageProvider,
  deleteFile,
  downloadBuffer,
  ensureStorageDirectory,
  openDownloadStream,
  storageRoot,
  uploadBuffer,
  validateStorageKey
};
