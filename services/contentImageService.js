const OpenAI = require('openai');
const { toFile } = require('openai');
const sharp = require('sharp');
const env = require('../config/env');
const ContentImage = require('../models/ContentImage');
const {
  deleteFile,
  downloadBuffer,
  activeStorageProvider,
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

function extractPosterText(value) {
  const text = String(value || '');
  const quoted = text.match(/["“]([^"”]{3,160})["”]/);
  if (quoted) return cleanText(quoted[1], 160);

  const saying = text.match(/\b(?:text|saying|say|headline|cta)\b\s*:?\s*([^.!?]{8,160})/i);
  return saying ? cleanText(saying[1], 160) : '';
}

const { resolveBrandDesignTokens, buildEnterpriseVisualPrompt } = require('./graphicDesignStudioService');

const VISUAL_FORMATS = new Set([
  'human-editorial-poster',
  'fashion-editorial',
  'ecommerce-product-scene',
  'minimal-product-visual',
  'ugc-lifestyle',
  'art-direction-campaign',
  'corporate-flyer',
  'b2b-carousel-slide',
  '3d-device-mockup',
  'data-infographic',
  'performance-ad-creative'
]);

const GRAPHIC_ASSET_FORMATS = new Set([
  'corporate-flyer',
  'b2b-carousel-slide',
  '3d-device-mockup',
  'data-infographic',
  'performance-ad-creative'
]);

const IMAGE_FIRST_FORMATS = new Set([
  'editorial-visual',
  'human-editorial-poster',
  'fashion-editorial',
  'ecommerce-product-scene',
  'minimal-product-visual',
  'ugc-lifestyle',
  'art-direction-campaign'
]);

function textIsExplicitlyRequested(value) {
  return /\b(?:add|include|show|use|write|render|with)\s+(?:the\s+)?(?:text|headline|copy|words?|caption|cta|call[-\s]?to[-\s]?action)\b|\b(?:text|headline|copy|saying|say|cta)\b\s*:/i.test(String(value || ''));
}

function detectVisualFormat({ guidance = '', draft = {}, requestedFormat = '' } = {}) {
  if (VISUAL_FORMATS.has(requestedFormat)) {
    return requestedFormat;
  }
  const signal = `${guidance} ${draft.title || ''} ${draft.type || ''}`;
  if (/\b(?:fashion|apparel|clothing|streetwear|beauty|cosmetic|jewelry|jewellery|skincare|lookbook|runway|editorial shoot|model shoot)\b/i.test(signal)) {
    return 'fashion-editorial';
  }
  if (/\b(?:e[-\s]?commerce|shop|store|product photo|product photography|product scene|packaging|catalog|catalogue|merch|retail|d2c|shoppable)\b/i.test(signal)) {
    return 'ecommerce-product-scene';
  }
  if (/\b(?:minimal|simple|clean|no text|without text|no words|image only|product only|less writing|not many words|caption will explain)\b/i.test(signal)) {
    return 'minimal-product-visual';
  }
  if (/\b(?:ugc|creator|influencer|selfie|phone shot|handheld|customer photo|founder video still|lifestyle shot)\b/i.test(signal)) {
    return 'ugc-lifestyle';
  }
  if (/\b(?:art direction|art[-\s]?house|creative campaign|conceptual|surreal|symbolic|gallery|culture|visual metaphor|abstract but tasteful)\b/i.test(signal)) {
    return 'art-direction-campaign';
  }
  if (/\b(?:human|authentic|natural|editorial|documentary|candid|ugc|real[-\s]?world|lifestyle|people|photo(?:graphic)?|less ai|not ai|human vibe)\b/i.test(signal)) {
    return 'human-editorial-poster';
  }
  if (/\b(?:carousel|slide deck|slide|multi-slide)\b/i.test(signal)) {
    return 'b2b-carousel-slide';
  }
  if (/\b(?:infographic|comparison table|metric badge|benchmark chart|matrix)\b/i.test(signal)) {
    return 'data-infographic';
  }
  if (/\b(?:mockup|3d device|device frame|isometric screen|laptop frame|tablet mockup)\b/i.test(signal)) {
    return '3d-device-mockup';
  }
  if (/\b(?:ad creative|paid ad|performance ad|direct response|facebook ad|meta ad|sponsored)\b/i.test(signal)) {
    return 'performance-ad-creative';
  }
  if (/\b(?:corporate flyer|saas corporate|feature cards?|grid layout|one-pager|brochure|comparison flyer)\b/i.test(signal)) {
    return 'corporate-flyer';
  }
  if (/\b(?:flyer|poster|advert(?:isement)?|campaign creative|feature announcement|product launch|banner|social graphic)\b/i.test(signal)) {
    return 'human-editorial-poster';
  }
  return 'editorial-visual';
}

function explicitLogoRequest(value) {
  return /\b(?:logo|brand mark|brandmark|logomark|wordmark|brand identity)\b/i.test(String(value || ''));
}

function logoIsExcluded(value) {
  return /\b(?:(?:without|exclude|omit|remove|no)\s+(?:the\s+)?(?:logo|brand mark|brandmark|logomark|wordmark)|(?:do not|don't)\s+(?:use|include|show|add)\s+(?:the\s+)?(?:logo|brand mark|brandmark|logomark|wordmark))\b/i.test(String(value || ''));
}

function cleanList(value, limit = 5, itemLimit = 240) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function draftBody(draft = {}) {
  return cleanText(draft.body || draft.copy || draft.content || draft.postCopy, 6000);
}

async function prepareBrandLogoForModel(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return buffer;
  return sharp(buffer)
    .trim({ threshold: 8 })
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

function normalizeChannel(draft = {}) {
  const value = cleanText(draft.channel || draft.type, 120).toLowerCase();
  if (/\binstagram\b|^ig$/.test(value)) return 'instagram';
  if (/\blinkedin\b/.test(value)) return 'linkedin';
  if (/\bfacebook\b|^fb$/.test(value)) return 'facebook';
  if (/\b(?:twitter|x)\b/.test(value)) return 'x';
  if (/\bemail\b|\bnewsletter\b/.test(value)) return 'email';
  return '';
}

function resolveImageOutputProfile({
  draft = {},
  visualFormat = 'editorial-visual',
  model = env.openaiImageModel
} = {}) {
  const channel = normalizeChannel(draft);
  const isGraphicAsset = GRAPHIC_ASSET_FORMATS.has(visualFormat);
  const isImageFirst = IMAGE_FIRST_FORMATS.has(visualFormat);
  const supportsFlexibleSize = /^gpt-image-2(?:$|-)/i.test(String(model || ''));
  const flexibleSizes = {
    instagram: '1088x1360',
    linkedin: '1200x1200',
    facebook: '1200x1200',
    x: '1536x864',
    email: '1536x864'
  };
  const legacySizes = {
    instagram: '1024x1536',
    linkedin: '1024x1024',
    facebook: '1024x1024',
    x: '1536x1024',
    email: '1536x1024'
  };
  const channelSize = supportsFlexibleSize ? flexibleSizes[channel] : legacySizes[channel];
  const size = channelSize
    || (isGraphicAsset ? (supportsFlexibleSize ? '1088x1360' : '1024x1536') : env.openaiImageSize);
  const [width, height] = /^\d+x\d+$/.test(size)
    ? size.split('x').map(Number)
    : [null, null];
  const orientation = width && height
    ? (width === height ? 'square' : width > height ? 'landscape' : 'portrait')
    : 'adaptive';

  return {
    channel,
    height,
    orientation,
    outputCompression: isGraphicAsset ? null : 94,
    outputFormat: isGraphicAsset ? 'png' : 'jpeg',
    quality: isGraphicAsset || isImageFirst || channel ? 'high' : env.openaiImageQuality,
    size,
    width
  };
}

function imagePrompt({
  project,
  draft,
  guidance,
  hasBrandLogoReference = false,
  visualFormat = 'editorial-visual',
  aestheticTheme = '',
  referenceImageInputIndex = null,
  brandLogoInputIndex = null,
  exactPosterText = '',
  outputProfile = null
}) {
  const execution = draft.executionContext || {};
  const profile = project.brand_profile || {};
  const proofPoints = cleanList(execution.proofPoints, 6);
  const evidence = cleanList(execution.evidenceHighlights, 4);
  const valueProps = cleanList(profile.valueProps, 4);
  const callsToAction = cleanList(profile.callsToAction || profile.calls_to_action, 3, 180);
  const body = draftBody(draft);
  const isGraphicAsset = GRAPHIC_ASSET_FORMATS.has(visualFormat);
  const isImageFirst = IMAGE_FIRST_FORMATS.has(visualFormat);
  const isHumanEditorial = visualFormat === 'human-editorial-poster';
  const isFashionEditorial = visualFormat === 'fashion-editorial';
  const isEcommerceProduct = visualFormat === 'ecommerce-product-scene';
  const isMinimalProduct = visualFormat === 'minimal-product-visual';
  const isUgcLifestyle = visualFormat === 'ugc-lifestyle';
  const isArtCampaign = visualFormat === 'art-direction-campaign';
  const explicitText = textIsExplicitlyRequested(guidance) || Boolean(exactPosterText);
  const logoMustAppear = Boolean(brandLogoInputIndex && (explicitLogoRequest(guidance) || (!isImageFirst && isGraphicAsset)));

  const brandTokens = resolveBrandDesignTokens({ project, draft });
  const theme = aestheticTheme || brandTokens.aestheticTheme;

  const enterprisePrompt = buildEnterpriseVisualPrompt({
    project,
    draft,
    visualFormat,
    aestheticTheme: theme,
    exactPosterText,
    guidance,
    outputProfile,
    brandTokens
  });

  return [
    enterprisePrompt,
    isImageFirst
      ? 'Act as a human-first brand art director and editorial photographer. Create a believable finished marketing image that feels culturally current, warm, and made by people with taste. Avoid anything that looks like a generic AI SaaS poster.'
      : isGraphicAsset
      ? 'Act as a senior SaaS art director and production designer. Create one complete, export-ready corporate marketing flyer from the supplied business facts, post, logo, references, and natural-language direction. You own the composition and should make the design decisions yourself.'
      : 'Create one polished visual asset that directly matches the supplied content and its intended business use.',
    `Content type or channel: ${cleanText(draft.type || draft.channel, 120) || 'marketing content asset'}.`,
    `Content title: ${cleanText(draft.title, 240) || 'Untitled content'}.`,
    `Approved source copy and message: ${body || 'No additional body copy was supplied.'}`,
    `Business: ${cleanText(project.name, 160)}.`,
    project.websiteUrl ? `Official website: ${cleanText(project.websiteUrl, 300)}.` : '',
    project.industry ? `Industry: ${cleanText(project.industry, 180)}.` : '',
    project.mainOffer ? `Primary offer: ${cleanText(project.mainOffer, 300)}.` : '',
    project.targetAudience ? `Audience: ${cleanText(project.targetAudience, 300)}.` : '',
    project.mainGoal ? `Business objective: ${cleanText(project.mainGoal, 300)}.` : '',
    project.brandTone ? `Brand tone: ${cleanText(project.brandTone, 240)}.` : '',
    valueProps.length ? `Known value propositions: ${valueProps.join(' | ')}.` : '',
    brandLogoInputIndex
      ? `Input image ${brandLogoInputIndex} is the official ${cleanText(project.name, 100)} transparent PNG logo and the only authorized logo. Use that supplied logo itself as source material. Preserve its recognizable mark, colors, wordmark, proportions, and orientation. Never redraw it, replace it, imitate it, create a second logo, or put it inside an invented badge. Treat transparent pixels as empty space.`
      : hasBrandLogoReference
        ? 'An official brand logo exists but is not attached to this request. Do not invent an alternative logo.'
        : 'No official brand logo reference was supplied. Do not invent a logo or brand mark.',
    logoMustAppear
      ? 'The final image itself must visibly contain the supplied logo exactly once, integrated naturally with professional scale, clear space, and safe margins. It must not be clipped, oversized, distorted, or placed over the headline. There is no later logo overlay, so finish its placement as part of this composition.'
      : brandLogoInputIndex
        ? 'Use the supplied logo as the visual identity source. Include it subtly if that improves this marketing asset; do not force it into a photographic scene.'
        : '',
    referenceImageInputIndex
      ? `Input image ${referenceImageInputIndex} is a user-selected visual reference. Use its relevant subject, product, or composition faithfully while adapting it into the finished design.`
      : '',
    execution.primaryCta ? `CTA context: ${cleanText(execution.primaryCta, 180)}.` : '',
    callsToAction.length ? `Known calls to action: ${callsToAction.join(' | ')}.` : '',
    proofPoints.length ? `Verified proof context: ${proofPoints.join(' | ')}.` : '',
    evidence.length ? `Verified source evidence: ${evidence.join(' | ')}.` : '',
    guidance ? `User art direction: ${cleanText(guidance, 1500)}.` : '',
    outputProfile && outputProfile.width && outputProfile.height
      ? `Final canvas: ${outputProfile.width} by ${outputProfile.height} pixels in ${outputProfile.orientation} orientation${outputProfile.channel ? `, composed specifically for ${outputProfile.channel}` : ''}. Keep every logo, headline, paragraph, CTA, icon, person, and product fully inside an inner 8% safe margin on all four sides. Nothing may touch, cross, or disappear beyond the canvas edge. Use the whole canvas intentionally and verify the complete composition before returning it.`
      : '',
    isImageFirst
      ? 'Art direction priority: make a strong image first. The caption outside the image can carry the explanation, so do not turn this into a text-heavy poster.'
      : '',
    isFashionEditorial
      ? 'Fashion and beauty rule: prioritize styling, model direction, fabric, product desire, premium lighting, and tasteful negative space. No feature cards, dashboard screens, CTA buttons, or explanatory paragraphs.'
      : '',
    isEcommerceProduct
      ? 'Ecommerce rule: make the product or purchasable offer the hero. Show realistic material, packaging, texture, scale, and use context. Keep the image simple enough for a storefront or paid social ad.'
      : '',
    isMinimalProduct
      ? 'Minimal visual rule: no headline, no CTA button, no paragraph, no icon grid, and no infographic labels unless the user explicitly asks for visible text. Use composition, light, texture, and product context instead.'
      : '',
    isUgcLifestyle
      ? 'UGC rule: make the scene feel like a credible creator/customer/founder moment with natural imperfections. Avoid glossy stock-photo perfection and synthetic ad-template polish.'
      : '',
    isArtCampaign
      ? 'Art campaign rule: use symbolism, composition, texture, and visual metaphor. It should feel like a memorable human-directed campaign concept, not a generic AI poster.'
      : '',
    isHumanEditorial
      ? 'Infer a human editorial composition without requiring a technical prompt: one believable subject or environment, natural light, restrained type, real texture, credible brand presence, and a quiet CTA when useful. The result must feel like a real social campaign asset, not a synthetic template, not a UI collage, and not a photograph with a text box pasted on top.'
      : isGraphicAsset
      ? 'Infer a strong hierarchy without requiring a technical prompt: integrated brand identity, concise headline, clear value proposition, relevant hero visual or supported product concept, scannable feature groups when useful, and a clear CTA. Follow the Swiss 12-column modular grid, 8pt vertical baseline rhythm, and maintain at least 30% unobstructed negative space. Apply C.R.A.P. design principles: high 4.5:1+ contrast, flush-left alignment, uniform card radii, and proximity-grouped atomic cards. The result must look like a finished premium SaaS campaign asset, not a photograph with a text box pasted on top.'
      : 'Use a premium, credible corporate editorial style with a clear focal subject, Swiss grid balance, and natural composition.',
    isImageFirst
      ? 'Do not invent testimonials, metrics, interface screens, awards, customers, or exaggerated product moments. Use context, props, environment, and people to communicate the message naturally.'
      : isGraphicAsset
      ? 'When the source contains many capabilities, select the most important supported points and arrange them as concise, readable feature groups. Do not invent capabilities, metrics, endorsements, prices, or customer claims.'
      : 'Do not add logos, statistics, product UI, people, locations, or claims that are not supported by the supplied content or reference images.',
    isImageFirst
      ? 'Avoid the obvious AI-poster pattern: no neon glow backgrounds, abstract circular orbits, giant 3D letters, floating arrows, glossy dashboard mockups, feature-card grids, blue-purple cyber gradients, overly perfect smiling stock models, or walls of promotional copy.'
      : isGraphicAsset
      ? 'A conceptual SaaS interface may be shown only when supported by the supplied content. It must be clearly illustrative with subtle 3D glassmorphism depth, and must not add unsupported product functionality.'
      : '',
    exactPosterText
      ? `Render this exact CTA once, spelled exactly as written and fully inside the safe margins: "${cleanText(exactPosterText, 160)}".`
      : '',
    'Return only the finished artwork. Do not show design notes, crop marks, dotted safe areas, wireframes, placeholders, labels such as "LOGO AREA", or unfinished layout instructions.',
    'Avoid fake logos, duplicate brand marks, malformed words, garbled text, watermarks, stock-template clutter, and generic AI imagery.',
    explicitText
      ? 'Because visible text was requested, keep it sparse, correctly spelled, and fully inside safe margins.'
      : isImageFirst
        ? 'Do not place visible text in the image. Let the social caption carry the message.'
        : '',
    isGraphicAsset
      ? 'Any visible copy must be concise, correctly spelled, easy to read, and derived from the supplied content. Do not fill the design with long paragraphs.'
      : 'Do not place text in the image unless the user explicitly asks for it.',
    'Use a balanced composition suitable for a professional marketing content asset.'
  ].filter(Boolean).join('\n');
}

function guidanceRequestsLogo(value) {
  return !logoIsExcluded(value);
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
      storageProvider: activeStorageProvider(),
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

async function generateContentImage({
  project,
  draft,
  userId,
  guidance = '',
  referenceImage = null,
  brandLogoReference = null,
  visualFormat = '',
  aestheticTheme = ''
}) {
  if (!env.openaiApiKey) {
    const error = new Error('OPENAI_API_KEY is required for image generation.');
    error.statusCode = 503;
    throw error;
  }

  const posterText = extractPosterText(guidance);
  const detectedFormat = detectVisualFormat({ guidance, draft, requestedFormat: visualFormat });
  const outputProfile = resolveImageOutputProfile({ draft, visualFormat: detectedFormat });
  const images = [];
  let referenceImageInputIndex = null;
  let brandLogoInputIndex = null;

  if (brandLogoReference && guidanceRequestsLogo(guidance)) {
    const preparedLogo = await prepareBrandLogoForModel(brandLogoReference.buffer);
    images.push(await toFile(
      preparedLogo,
      brandLogoReference.filename || 'official-brand-logo.png',
      { type: brandLogoReference.mimeType || 'image/png' }
    ));
    brandLogoInputIndex = images.length;
  }
  if (referenceImage) {
    const referenceBuffer = await downloadBuffer(referenceImage.storageKey);
    images.push(await toFile(referenceBuffer, referenceImage.filename, { type: referenceImage.mimeType }));
    referenceImageInputIndex = images.length;
  }

  const prompt = imagePrompt({
    project,
    draft,
    guidance,
    hasBrandLogoReference: Boolean(brandLogoReference),
    visualFormat: detectedFormat,
    aestheticTheme,
    referenceImageInputIndex,
    brandLogoInputIndex,
    exactPosterText: posterText,
    outputProfile
  });
  const client = new OpenAI({ apiKey: env.openaiApiKey });
  let response;

  if (images.length) {
    const editRequest = {
      model: env.openaiImageModel,
      image: images.length === 1 ? images[0] : images,
      prompt,
      n: 1,
      output_format: outputProfile.outputFormat,
      quality: outputProfile.quality,
      size: outputProfile.size,
      user: cleanText(userId, 120)
    };
    if (outputProfile.outputCompression) {
      editRequest.output_compression = outputProfile.outputCompression;
    }
    if (!/^gpt-image-2(?:$|-)/i.test(env.openaiImageModel)) {
      editRequest.input_fidelity = 'high';
    }
    response = await client.images.edit(editRequest);
  } else {
    const generationRequest = {
      model: env.openaiImageModel,
      prompt,
      n: 1,
      output_format: outputProfile.outputFormat,
      quality: outputProfile.quality,
      size: outputProfile.size,
      user: cleanText(userId, 120)
    };
    if (outputProfile.outputCompression) {
      generationRequest.output_compression = outputProfile.outputCompression;
    }
    response = await client.images.generate(generationRequest);
  }

  const encoded = response && response.data && response.data[0] && response.data[0].b64_json;
  if (!encoded) throw new Error('The image provider returned no image data.');

  const buffer = Buffer.from(encoded, 'base64');
  const isPng = outputProfile.outputFormat === 'png';
  const mimeType = isPng ? 'image/png' : 'image/jpeg';
  const filename = `moyi-${draft._id}-${Date.now()}.${isPng ? 'png' : 'jpg'}`;
  const storageKey = await uploadBuffer({
    buffer,
    mimeType
  });

  try {
    return await ContentImage.create({
      projectId: project._id,
      draftId: draft._id,
      userId,
      storageProvider: activeStorageProvider(),
      storageKey,
      source: 'generated',
      referenceImageId: referenceImage ? referenceImage._id : null,
      filename,
      mimeType,
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
  detectVisualFormat,
  detectImageMimeType,
  extractPosterText,
  generateContentImage,
  guidanceRequestsLogo,
  imagePrompt,
  prepareBrandLogoForModel,
  rejectContentImage,
  resolveImageOutputProfile,
  restoreContentImage,
  saveUploadedImage,
  selectContentImage,
  validateUpload
};
