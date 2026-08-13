const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const MediaAsset = require('../models/MediaAsset');
const { deleteMediaFile } = require('./mediaStorageService');

function managedTemporaryPath(value) {
  if (!value) return '';
  const root = path.resolve(env.mediaUploadTempPath);
  const candidate = path.resolve(String(value));
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : '';
}

async function deleteMediaAssetsForProject(projectId) {
  const assets = await MediaAsset.find({ projectId }).select('+temporaryPath').lean();
  const storageKeys = [...new Set(assets.flatMap((asset) => [
    asset.storageKey,
    ...Object.values(asset.variants || {}).map((variant) => variant && variant.storageKey)
  ]).filter((key) => String(key || '').startsWith('social-media/')))];
  const temporaryPaths = [...new Set(assets
    .map((asset) => managedTemporaryPath(asset.temporaryPath))
    .filter(Boolean))];

  await Promise.all([
    ...storageKeys.map((storageKey) => deleteMediaFile(storageKey)),
    ...temporaryPaths.map((temporaryPath) => fs.promises.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    }))
  ]);
  return MediaAsset.deleteMany({ projectId });
}

module.exports = {
  deleteMediaAssetsForProject,
  managedTemporaryPath
};
