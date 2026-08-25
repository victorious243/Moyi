const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const env = require('../config/env');
const MediaAsset = require('../models/MediaAsset');
const PublishJob = require('../models/PublishJob');
const { downloadBuffer: downloadContentImageBuffer } = require('./contentImageStorageService');
const {
  activeMediaStorageProvider,
  deleteMediaFile,
  downloadMediaToFile,
  ensureMediaDirectories,
  uploadMediaFile
} = require('./mediaStorageService');
const { VARIANT_PROFILES, variantKey } = require('./mediaProfileService');
const { reenqueueMediaProcessing } = require('../queues/mediaQueue');

const EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm'
});

function generatedStorageKeys(asset) {
  const prefix = `social-media/${asset._id}`;
  const originalExtension = EXTENSIONS[asset.mimeType];
  return [...new Set([
    ...(originalExtension ? [`${prefix}/original${originalExtension}`] : []),
    ...Object.keys(VARIANT_PROFILES).map((profileName) => (
      `${prefix}/${variantKey(profileName, asset.kind)}${asset.kind === 'image' ? '.jpg' : '.mp4'}`
    )),
    asset.storageKey,
    ...Object.values(asset.variants || {}).map((variant) => variant && variant.storageKey)
  ].filter((key) => String(key || '').startsWith(`${prefix}/`)))];
}

function cleanProcessingError(error) {
  return String(error && error.message ? error.message : 'Media processing failed.')
    .replaceAll(env.mediaUploadTempPath, '[upload directory]')
    .replaceAll(os.tmpdir(), '[temporary directory]')
    .slice(0, 1200);
}

function runProcess(command, args, { timeoutMs = 45 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error(`${path.basename(command)} exceeded the media processing time limit.`);
      error.code = 'media_process_timeout';
      reject(error);
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-12000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        const missing = new Error(`${path.basename(command)} is not installed. Install FFmpeg and configure FFMPEG_PATH and FFPROBE_PATH.`);
        missing.code = 'ffmpeg_not_installed';
        reject(missing);
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else {
        const error = new Error(`${path.basename(command)} failed: ${stderr.split('\n').filter(Boolean).slice(-4).join(' ')}`);
        error.code = 'media_transform_failed';
        reject(error);
      }
    });
  });
}

function captureProcess(command, args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} timed out.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        const missing = new Error(`${path.basename(command)} is not installed. Install FFmpeg and configure FFMPEG_PATH and FFPROBE_PATH.`);
        missing.code = 'ffmpeg_not_installed';
        reject(missing);
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`${path.basename(command)} failed: ${Buffer.concat(stderr).toString('utf8').slice(-1200)}`));
    });
  });
}

async function probeVideo(filePath) {
  const output = await captureProcess(env.ffprobePath, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ]);
  const data = JSON.parse(output);
  const stream = (data.streams || []).find((entry) => entry.codec_type === 'video');
  if (!stream) {
    const error = new Error('The uploaded file does not contain a video stream.');
    error.code = 'invalid_video';
    throw error;
  }
  const durationSeconds = Number(stream.duration || data.format?.duration || 0);
  return {
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    durationMs: durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null
  };
}

async function sourcePathForAsset(asset, workingDirectory) {
  if (asset.temporaryPath) {
    await fs.promises.access(asset.temporaryPath, fs.constants.R_OK);
    return { filePath: asset.temporaryPath, removeAfter: true };
  }
  const extension = EXTENSIONS[asset.mimeType] || '';
  const target = path.join(workingDirectory, `source${extension}`);
  if (asset.sourceContentImageId && !String(asset.storageKey || '').startsWith('social-media/')) {
    const buffer = await downloadContentImageBuffer(asset.storageKey);
    await fs.promises.writeFile(target, buffer, { mode: 0o600 });
    return { filePath: target, removeAfter: false };
  }
  if (asset.storageKey) {
    await downloadMediaToFile(asset.storageKey, target);
    return { filePath: target, removeAfter: false };
  }
  const error = new Error('The original upload is no longer available. Upload the media again.');
  error.code = 'media_source_missing';
  throw error;
}

async function uploadVariant(asset, profileName, outputPath, metadata) {
  const key = variantKey(profileName, asset.kind);
  const extension = asset.kind === 'image' ? '.jpg' : '.mp4';
  const storageKey = `social-media/${asset._id}/${key}${extension}`;
  const stat = await fs.promises.stat(outputPath);
  await uploadMediaFile({
    filePath: outputPath,
    storageKey,
    mimeType: asset.kind === 'image' ? 'image/jpeg' : 'video/mp4'
  });
  return {
    key,
    profile: profileName,
    ratio: VARIANT_PROFILES[profileName].ratio,
    storageKey,
    mimeType: asset.kind === 'image' ? 'image/jpeg' : 'video/mp4',
    size: stat.size,
    width: VARIANT_PROFILES[profileName].width,
    height: VARIANT_PROFILES[profileName].height,
    durationMs: metadata.durationMs || null,
    status: 'ready',
    generatedAt: new Date().toISOString()
  };
}

async function renderImageVariant(sourcePath, profile) {
  return sharp(sourcePath)
    .rotate()
    .resize(profile.width, profile.height, {
      fit: 'contain',
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function generateImageVariants(asset, sourcePath, workingDirectory) {
  const variants = {};
  for (const [profileName, profile] of Object.entries(VARIANT_PROFILES)) {
    const outputPath = path.join(workingDirectory, `${profileName}.jpg`);
    await fs.promises.writeFile(outputPath, await renderImageVariant(sourcePath, profile));
    const variant = await uploadVariant(asset, profileName, outputPath, {});
    variants[variant.key] = variant;
  }
  return variants;
}

async function generateVideoVariants(asset, sourcePath, workingDirectory, metadata) {
  const variants = {};
  for (const [profileName, profile] of Object.entries(VARIANT_PROFILES)) {
    const outputPath = path.join(workingDirectory, `${profileName}.mp4`);
    const videoFilter = [
      `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease`,
      `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1'
    ].join(',');
    await runProcess(env.ffmpegPath, [
      '-y',
      '-i', sourcePath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-map_metadata', '-1',
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-maxrate', '8M',
      '-bufsize', '16M',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-movflags', '+faststart',
      outputPath
    ]);
    const variant = await uploadVariant(asset, profileName, outputPath, metadata);
    variants[variant.key] = variant;
  }
  return variants;
}

async function releasePreparedPublishJobs(assetId) {
  const jobs = await PublishJob.find({ mediaIds: assetId, status: 'preparing_media' });
  if (!jobs.length) return;
  const { enqueuePublishJob } = require('../queues/publishQueue');
  const { refreshBatchSummary } = require('./contentDistributionEngineService');
  const batchIds = new Set();
  for (const job of jobs) {
    const assets = await MediaAsset.find({ _id: { $in: job.mediaIds } }).select('status processingError');
    if (assets.some((asset) => asset.status === 'failed')) {
      const failedAsset = assets.find((asset) => asset.status === 'failed');
      job.status = 'failed';
      job.errorCode = 'media_processing_failed';
      job.errorMessage = failedAsset.processingError || 'A selected media file could not be processed.';
      await job.save();
      batchIds.add(String(job.batchId));
      continue;
    }
    if (!assets.length || assets.some((asset) => asset.status !== 'ready')) continue;
    job.status = 'queued';
    await job.save();
    await enqueuePublishJob(job._id, job.scheduledAt);
    batchIds.add(String(job.batchId));
  }
  await Promise.all([...batchIds].map((batchId) => refreshBatchSummary(batchId)));
}

async function processMediaAsset(assetId, { finalAttempt = true } = {}) {
  const asset = await MediaAsset.findOneAndUpdate(
    { _id: assetId, status: { $in: ['queued', 'failed'] } },
    { $set: { status: 'processing', processingError: '' } },
    { returnDocument: 'after' }
  ).select('+temporaryPath');
  if (!asset) {
    const current = await MediaAsset.findById(assetId);
    if (current && current.status === 'ready') return current;
    throw new Error('Media asset is already being processed or no longer exists.');
  }

  await ensureMediaDirectories();
  const workingDirectory = await fs.promises.mkdtemp(path.join(env.mediaUploadTempPath, 'process-'));
  let source;
  let completed = false;
  try {
    source = await sourcePathForAsset(asset, workingDirectory);
    let metadata;
    if (asset.kind === 'image') {
      const imageMetadata = await sharp(source.filePath).metadata();
      if (!imageMetadata.width || !imageMetadata.height) throw new Error('The uploaded image dimensions could not be read.');
      metadata = { width: imageMetadata.width, height: imageMetadata.height, durationMs: null };
    } else {
      metadata = await probeVideo(source.filePath);
    }

    const originalExtension = EXTENSIONS[asset.mimeType];
    if (!originalExtension) throw new Error('The uploaded media format is not supported.');
    const originalStorageKey = `social-media/${asset._id}/original${originalExtension}`;
    await uploadMediaFile({ filePath: source.filePath, storageKey: originalStorageKey, mimeType: asset.mimeType });

    const variants = asset.kind === 'image'
      ? await generateImageVariants(asset, source.filePath, workingDirectory)
      : await generateVideoVariants(asset, source.filePath, workingDirectory, metadata);
    const ready = await MediaAsset.findByIdAndUpdate(asset._id, {
      $set: {
        storageProvider: activeMediaStorageProvider(),
        storageKey: originalStorageKey,
        originalUrl: '',
        temporaryPath: '',
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
        variants,
        status: 'ready',
        processingError: ''
      }
    }, { returnDocument: 'after' });
    completed = true;
    await releasePreparedPublishJobs(asset._id);
    return ready;
  } catch (error) {
    const message = cleanProcessingError(error);
    if (finalAttempt) {
      await Promise.allSettled(generatedStorageKeys(asset).map((storageKey) => deleteMediaFile(storageKey)));
    }
    await MediaAsset.updateOne({ _id: asset._id }, {
      $set: {
        status: finalAttempt ? 'failed' : 'queued',
        processingError: finalAttempt ? message : `Retrying after processing error: ${message}`
      }
    });
    if (finalAttempt) await releasePreparedPublishJobs(asset._id);
    throw error;
  } finally {
    await fs.promises.rm(workingDirectory, { recursive: true, force: true }).catch(() => null);
    if (completed && source && source.removeAfter) {
      await fs.promises.unlink(source.filePath).catch(() => null);
    }
  }
}

async function recoverMediaAssets({ limit = 100 } = {}) {
  await MediaAsset.updateMany(
    { status: 'processing', updatedAt: { $lte: new Date(Date.now() - 60 * 60 * 1000) } },
    { $set: { status: 'queued', processingError: 'Media processing was interrupted and has been queued again.' } }
  );
  const assets = await MediaAsset.find({ status: 'queued' }).sort({ createdAt: 1 }).limit(limit);
  for (const asset of assets) await reenqueueMediaProcessing(asset._id);
  return { recovered: assets.length };
}

module.exports = {
  EXTENSIONS,
  cleanProcessingError,
  generateImageVariants,
  generatedStorageKeys,
  probeVideo,
  processMediaAsset,
  recoverMediaAssets,
  renderImageVariant,
  releasePreparedPublishJobs,
  runProcess
};
