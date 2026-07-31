const OpenAI = require('openai');
const { toFile } = require('openai');
const env = require('../config/env');
const ContentImage = require('../models/ContentImage');
const {
  deleteFile,
  downloadBuffer,
  uploadBuffer
} = require('./contentImageStorageService');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function cleanText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

function imagePrompt({ project, draft, guidance, hasBrandLogoReference = false }) {
  const execution = draft.executionContext || {};
  const proofPoints = Array.isArray(execution.proofPoints) ? execution.proofPoints : [];
  const body = cleanText(draft.body, 5000);

  return [
    'Create one polished visual asset that directly matches the supplied content and its intended business use.',
    `Content type: ${cleanText(draft.type, 120) || 'content asset'}.`,
    `Content title: ${cleanText(draft.title, 240) || 'Untitled content'}.`,
    `Content body: ${body || 'No body content was supplied.'}`,
    `Business: ${cleanText(project.name, 160)}.`,
    project.mainOffer ? `Primary offer: ${cleanText(project.mainOffer, 300)}.` : '',
    project.targetAudience ? `Audience: ${cleanText(project.targetAudience, 300)}.` : '',
    project.brandTone ? `Brand tone: ${cleanText(project.brandTone, 240)}.` : '',
    hasBrandLogoReference
      ? 'Official brand logo reference supplied. If the user asks for a logo, use the supplied logo as the source of truth; do not invent or redesign it.'
      : 'No official brand logo reference supplied. Do not invent a logo or brand mark.',
    execution.primaryCta ? `CTA context: ${cleanText(execution.primaryCta, 180)}.` : '',
    proofPoints.length ? `Verified proof context: ${proofPoints.slice(0, 5).map((item) => cleanText(item, 240)).join(' | ')}.` : '',
    guidance ? `User art direction: ${cleanText(guidance, 1500)}.` : '',
    'Use a premium, credible corporate editorial style with a clear focal subject and natural composition.',
    'Do not add logos, statistics, product UI, people, locations, or claims that are not supported by the supplied content or reference images.',
    'Avoid generic AI imagery, floating interface fragments, garbled text, watermarks, and decorative typography.',
    'Do not place text in the image unless the user explicitly asks for it.',
    'Use a balanced composition suitable for a professional marketing content asset.'
  ].filter(Boolean).join('\n');
}

function validateUpload(file) {
  if (!file || !file.buffer || !file.size) {
    const error = new Error('Choose an image to upload.');
    error.statusCode = 422;
    throw error;
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    const error = new Error('Upload a JPG, PNG, or WebP image.');
    error.statusCode = 422;
    throw error;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const error = new Error('Image uploads must be 10 MB or smaller.');
    error.statusCode = 422;
    throw error;
  }
  const detectedMimeType = detectImageMimeType(file.buffer);
  if (!detectedMimeType || detectedMimeType !== file.mimetype) {
    const error = new Error('The uploaded file content does not match a valid JPG, PNG, or WebP image.');
    error.statusCode = 422;
    throw error;
  }
}

async function saveUploadedImage({ project, draft, userId, file, altText = '', caption = '' }) {
  validateUpload(file);
  const filename = cleanText(file.originalname, 180) || `content-image-${Date.now()}`;
  const storageKey = await uploadBuffer({
    buffer: file.buffer,
    mimeType: file.mimetype
  });

  try {
    return await ContentImage.create({
      projectId: project._id,
      draftId: draft._id,
      userId,
      storageProvider: 'machine',
      storageKey,
      source: 'uploaded',
      filename,
      mimeType: file.mimetype,
      byteLength: file.size,
      altText: cleanText(altText, 240),
      caption: cleanText(caption, 500)
    });
  } catch (error) {
    await deleteFile(storageKey).catch(() => null);
    throw error;
  }
}

async function generateContentImage({ project, draft, userId, guidance = '', referenceImage = null, brandLogoReference = null }) {
  if (!env.openaiApiKey) {
    const error = new Error('OPENAI_API_KEY is required for image generation.');
    error.statusCode = 503;
    throw error;
  }

  const prompt = imagePrompt({
    project,
    draft,
    guidance,
    hasBrandLogoReference: Boolean(brandLogoReference)
  });
  const client = new OpenAI({ apiKey: env.openaiApiKey });
  let response;

  if (referenceImage || brandLogoReference) {
    const images = [];
    if (referenceImage) {
      const referenceBuffer = await downloadBuffer(referenceImage.storageKey);
      images.push(await toFile(referenceBuffer, referenceImage.filename, { type: referenceImage.mimeType }));
    }
    if (brandLogoReference) {
      images.push(await toFile(brandLogoReference.buffer, brandLogoReference.filename, { type: brandLogoReference.mimeType }));
    }
    response = await client.images.edit({
      model: env.openaiImageModel,
      image: images.length === 1 ? images[0] : images,
      prompt,
      input_fidelity: 'high',
      n: 1,
      output_format: 'jpeg',
      quality: env.openaiImageQuality,
      size: env.openaiImageSize
    });
  } else {
    response = await client.images.generate({
      model: env.openaiImageModel,
      prompt,
      n: 1,
      output_format: 'jpeg',
      quality: env.openaiImageQuality,
      size: env.openaiImageSize
    });
  }

  const encoded = response && response.data && response.data[0] && response.data[0].b64_json;
  if (!encoded) throw new Error('The image provider returned no image data.');

  const buffer = Buffer.from(encoded, 'base64');
  const filename = `moyi-${draft._id}-${Date.now()}.jpg`;
  const storageKey = await uploadBuffer({
    buffer,
    mimeType: 'image/jpeg'
  });

  try {
    return await ContentImage.create({
      projectId: project._id,
      draftId: draft._id,
      userId,
      storageProvider: 'machine',
      storageKey,
      source: 'generated',
      referenceImageId: referenceImage ? referenceImage._id : null,
      filename,
      mimeType: 'image/jpeg',
      byteLength: buffer.length,
      prompt,
      guidance: cleanText(guidance, 1500),
      altText: cleanText(draft.title, 240),
      model: env.openaiImageModel
    });
  } catch (error) {
    await deleteFile(storageKey).catch(() => null);
    throw error;
  }
}

async function selectContentImage({ draft, image }) {
  await ContentImage.updateMany(
    { draftId: draft._id, status: 'selected', _id: { $ne: image._id } },
    { $set: { status: 'candidate', selectedAt: null } }
  );
  image.status = 'selected';
  image.selectedAt = new Date();
  await image.save();
  if (Object.prototype.hasOwnProperty.call(draft.toObject ? draft.toObject() : draft, 'contentImageId')) {
    draft.contentImageId = image._id;
  }
  draft.selectedImageId = image._id;
  await draft.save();
  return image;
}

async function rejectContentImage({ draft, image }) {
  image.status = 'rejected';
  image.selectedAt = null;
  await image.save();
  if (draft.contentImageId && String(draft.contentImageId) === String(image._id)) {
    draft.contentImageId = null;
  }
  if (draft.selectedImageId && String(draft.selectedImageId) === String(image._id)) {
    draft.selectedImageId = null;
  }
  await draft.save();
  return image;
}

async function restoreContentImage(image) {
  image.status = 'candidate';
  image.selectedAt = null;
  await image.save();
  return image;
}

async function deleteContentImagesForProject(projectId) {
  const images = await ContentImage.find({ projectId }).select('storageKey').lean();
  await Promise.all(images.map((image) => deleteFile(image.storageKey).catch(() => null)));
  await ContentImage.deleteMany({ projectId });
  return images.length;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteContentImagesForProject,
  detectImageMimeType,
  generateContentImage,
  imagePrompt,
  rejectContentImage,
  restoreContentImage,
  saveUploadedImage,
  selectContentImage,
  validateUpload
};
