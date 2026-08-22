const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const sharp = require('sharp');
const env = require('../config/env');
const ContentImage = require('../models/ContentImage');
const {
  deleteFile,
  downloadBuffer,
  openDownloadStream,
  uploadBuffer
} = require('../services/contentImageStorageService');
const {
  detectVisualFormat,
  detectImageMimeType,
  extractPosterText,
  guidanceRequestsLogo,
  imagePrompt,
  prepareBrandLogoForModel,
  resolveImageOutputProfile,
  validateUpload
} = require('../services/contentImageService');

function uploadFixture(buffer, mimetype) {
  return {
    buffer,
    mimetype,
    originalname: 'article-image',
    size: buffer.length
  };
}

test('content image prompt is grounded in the draft, business, proof, and user direction', () => {
  const prompt = imagePrompt({
    project: {
      name: 'Moyi',
      mainOffer: 'Evidence-backed AI CMO planning',
      targetAudience: 'SaaS founders',
      brandTone: 'Direct and credible'
    },
    draft: {
      title: 'How to turn search evidence into a growth plan',
      body: 'The guide explains how a team audits pages and prioritizes verified opportunities.',
      executionContext: {
        primaryCta: 'Run a website audit',
        proofPoints: ['Recommendations are linked to scan findings']
      }
    },
    guidance: 'Show a marketing lead reviewing a clear planning board.'
  });

  assert.match(prompt, /How to turn search evidence into a growth plan/);
  assert.match(prompt, /audits pages and prioritizes verified opportunities/);
  assert.match(prompt, /Evidence-backed AI CMO planning/);
  assert.match(prompt, /Recommendations are linked to scan findings/);
  assert.match(prompt, /marketing lead reviewing a clear planning board/);
  assert.match(prompt, /Do not invent testimonials, metrics, interface screens/);
});

test('content image upload validation checks real file signatures', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');

  assert.equal(detectImageMimeType(jpeg), 'image/jpeg');
  assert.equal(detectImageMimeType(png), 'image/png');
  assert.equal(detectImageMimeType(webp), 'image/webp');
  assert.doesNotThrow(() => validateUpload(uploadFixture(jpeg, 'image/jpeg')));
  assert.doesNotThrow(() => validateUpload(uploadFixture(png, 'image/png')));
  assert.doesNotThrow(() => validateUpload(uploadFixture(webp, 'image/webp')));
  assert.throws(
    () => validateUpload(uploadFixture(Buffer.from('not an image'), 'image/png')),
    /does not match a valid/
  );
  assert.throws(
    () => validateUpload(uploadFixture(jpeg, 'image/png')),
    /does not match a valid/
  );
});

test('content image prompt turns a natural poster request into a logo-aware SaaS design brief', () => {
  const guidance = 'put the logo visible in the image use the actual logo for vicpods with some text saying "Start using VicPods for free at vicpods.com" make it looks professional as you are making an ad poster';
  const visualFormat = detectVisualFormat({ guidance, draft: { title: 'Start your podcast journey' } });
  const prompt = imagePrompt({
    project: {
      name: 'VicPods',
      websiteUrl: 'https://vicpods.com',
      targetAudience: 'Podcast creators',
      mainOffer: 'Plan, produce, and publish podcasts',
      brand_profile: { valueProps: ['Turn rough ideas into structured episodes'] }
    },
    draft: {
      channel: 'instagram',
      title: 'Start your podcast journey',
      body: 'Join VicPods and create a podcast.'
    },
    guidance,
    hasBrandLogoReference: true,
    visualFormat,
    brandLogoInputIndex: 1,
    exactPosterText: extractPosterText(guidance)
  });

  assert.equal(guidanceRequestsLogo('please add the logo'), true);
  assert.equal(guidanceRequestsLogo('make a polished SaaS corporate flyer'), true);
  assert.equal(guidanceRequestsLogo('create a natural editorial image'), true);
  assert.equal(guidanceRequestsLogo('make a flyer without the logo'), false);
  assert.equal(visualFormat, 'human-editorial-poster');
  assert.equal(extractPosterText(guidance), 'Start using VicPods for free at vicpods.com');
  assert.match(prompt, /human-first brand art director and editorial photographer/);
  assert.match(prompt, /Input image 1 is the official VicPods transparent PNG logo/);
  assert.match(prompt, /only authorized logo/);
  assert.match(prompt, /final image itself must visibly contain the supplied logo exactly once/);
  assert.match(prompt, /There is no later logo overlay/);
  assert.match(prompt, /real social campaign asset/);
  assert.match(prompt, /Avoid the obvious AI-poster pattern/);
  assert.match(prompt, /Turn rough ideas into structured episodes/);
  assert.match(prompt, /Official website: https:\/\/vicpods.com/);
  assert.match(prompt, /User art direction: put the logo visible/);
  assert.match(prompt, /Start using VicPods for free at vicpods.com/);
  assert.match(prompt, /Render this exact CTA once/);
  assert.match(prompt, /Do not show design notes, crop marks, dotted safe areas/);
});

test('explicit corporate flyer requests still use the structured SaaS design skill', () => {
  const guidance = 'make a corporate flyer with a grid layout and feature cards';
  const visualFormat = detectVisualFormat({ guidance, draft: { title: 'VicPods New Features' } });
  assert.equal(visualFormat, 'corporate-flyer');
});

test('content image detects non-SaaS creative modes and keeps image-first prompts light on text', () => {
  assert.equal(
    detectVisualFormat({ guidance: 'fashion lookbook shoot for a new streetwear drop' }),
    'fashion-editorial'
  );
  assert.equal(
    detectVisualFormat({ guidance: 'ecommerce product photography with packaging on a clean table' }),
    'ecommerce-product-scene'
  );
  assert.equal(
    detectVisualFormat({ guidance: 'simple no text image only, caption will explain' }),
    'minimal-product-visual'
  );
  assert.equal(
    detectVisualFormat({ guidance: 'make it feel like a creator UGC phone shot' }),
    'ugc-lifestyle'
  );
  assert.equal(
    detectVisualFormat({ guidance: 'art direction campaign using a symbolic visual metaphor' }),
    'art-direction-campaign'
  );

  const prompt = imagePrompt({
    project: { name: 'Mira Atelier', industry: 'Fashion apparel', mainOffer: 'Handmade linen dresses' },
    draft: { channel: 'instagram', title: 'Summer linen drop', body: 'A quiet launch for warm-weather pieces.' },
    guidance: 'minimal fashion editorial, no text, natural daylight',
    visualFormat: 'fashion-editorial',
    aestheticTheme: 'luxury-fashion'
  });

  assert.match(prompt, /Fashion and beauty rule/);
  assert.match(prompt, /make a strong image first/);
  assert.match(prompt, /Do not place visible text in the image/);
  assert.match(prompt, /no feature cards, dashboard screens, CTA buttons, or explanatory paragraphs/i);
});

test('long natural-language feature prompts remain available to the flyer designer', () => {
  const guidance = 'VicPods New Features Studio workflow and approvals Organize podcast production with collaborator roles, approvals, comments, and tasks. Launch prep workspace Keep episode structure, launch assets, prep notes, and recording readiness in one place. Analytics and growth reporting Track performance and understand listener engagement trends. Podcast publishing Publish hosted shows with audio uploads, public episode pages, RSS feeds, and embeds. make a flyer use VicPods logo it needs to be SaaS corporate';
  const visualFormat = detectVisualFormat({ guidance, draft: { title: 'VicPods New Features' } });
  const prompt = imagePrompt({
    project: { name: 'VicPods', mainOffer: 'Plan, produce, publish, and grow a podcast.' },
    draft: { title: 'VicPods New Features', body: 'A product update for podcast creators.' },
    guidance,
    hasBrandLogoReference: true,
    visualFormat,
    brandLogoInputIndex: 1
  });

  assert.equal(visualFormat, 'corporate-flyer');
  assert.equal(guidanceRequestsLogo(guidance), true);
  assert.match(prompt, /Studio workflow and approvals/);
  assert.match(prompt, /Podcast publishing/);
  assert.match(prompt, /select the most important supported points/);
});

test('content image prepares the official logo reference without inventing a layout or background', async () => {
  const mark = await sharp({
    create: {
      width: 140,
      height: 60,
      channels: 4,
      background: { r: 91, g: 92, b: 255, alpha: 1 }
    }
  }).png().toBuffer();
  const paddedLogo = await sharp({
    create: {
      width: 360,
      height: 220,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite([{ input: mark, left: 110, top: 80 }]).png().toBuffer();

  const prepared = await prepareBrandLogoForModel(paddedLogo);
  const metadata = await sharp(prepared).metadata();

  assert.equal(metadata.format, 'png');
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.width, 140);
  assert.equal(metadata.height, 60);
});

test('content image output uses high-quality platform-native flyer dimensions', () => {
  const instagram = resolveImageOutputProfile({
    draft: { channel: 'instagram' },
    visualFormat: 'corporate-flyer',
    model: 'gpt-image-2'
  });
  const linkedin = resolveImageOutputProfile({
    draft: { channel: 'linkedin' },
    visualFormat: 'corporate-flyer',
    model: 'gpt-image-2'
  });
  const twitter = resolveImageOutputProfile({
    draft: { channel: 'x' },
    visualFormat: 'corporate-flyer',
    model: 'gpt-image-2'
  });

  assert.deepEqual(
    { size: instagram.size, quality: instagram.quality, format: instagram.outputFormat },
    { size: '1088x1360', quality: 'high', format: 'png' }
  );
  assert.equal(instagram.orientation, 'portrait');
  assert.equal(linkedin.size, '1200x1200');
  assert.equal(linkedin.orientation, 'square');
  assert.equal(twitter.size, '1536x864');
  assert.equal(twitter.orientation, 'landscape');
  assert.equal(resolveImageOutputProfile({
    draft: { channel: 'instagram' },
    visualFormat: 'editorial-visual',
    model: 'gpt-image-2'
  }).quality, 'high');
});

test('content image prompt protects the complete composition inside the output canvas', () => {
  const outputProfile = resolveImageOutputProfile({
    draft: { channel: 'instagram' },
    visualFormat: 'corporate-flyer',
    model: 'gpt-image-2'
  });
  const prompt = imagePrompt({
    project: { name: 'VicPods' },
    draft: { channel: 'instagram', title: 'Join VicPods' },
    guidance: 'Create a professional SaaS flyer.',
    visualFormat: 'corporate-flyer',
    outputProfile
  });

  assert.match(prompt, /Final canvas: 1088 by 1360 pixels in portrait orientation/);
  assert.match(prompt, /inner 8% safe margin on all four sides/);
  assert.match(prompt, /Nothing may touch, cross, or disappear beyond the canvas edge/);
});

test('content image records require durable file and draft ownership metadata', () => {
  const image = new ContentImage({
    projectId: new mongoose.Types.ObjectId(),
    draftId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    storageProvider: 'machine',
    storageKey: '123e4567-e89b-12d3-a456-426614174000.jpg',
    source: 'generated',
    filename: 'moyi-article.jpg',
    mimeType: 'image/jpeg',
    byteLength: 4096,
    status: 'candidate'
  });

  assert.equal(image.validateSync(), undefined);

  image.storageKey = '';
  assert.ok(image.validateSync().errors.storageKey);
});

test('content image binaries are written to private machine storage, not MongoDB', async () => {
  const originalStoragePath = env.contentImageStoragePath;
  const originalStorageProvider = env.contentImageStorageProvider;
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'moyi-content-images-'));
  env.contentImageStorageProvider = 'machine';
  env.contentImageStoragePath = temporaryRoot;

  try {
    const source = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    const storageKey = await uploadBuffer({ buffer: source, mimeType: 'image/jpeg' });
    const storedPath = path.join(temporaryRoot, storageKey);
    const stored = await downloadBuffer(storageKey);

    assert.deepEqual(stored, source);
    assert.equal((await fs.promises.stat(storedPath)).mode & 0o777, 0o600);

    const streamed = [];
    for await (const chunk of openDownloadStream(storageKey)) streamed.push(chunk);
    assert.deepEqual(Buffer.concat(streamed), source);

    await deleteFile(storageKey);
    await assert.rejects(fs.promises.stat(storedPath), { code: 'ENOENT' });
  } finally {
    env.contentImageStorageProvider = originalStorageProvider;
    env.contentImageStoragePath = originalStoragePath;
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
});
