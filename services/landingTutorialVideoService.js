const DIRECT_VIDEO_EXTENSIONS = /\.(?:mp4|webm|ogg)(?:$|[?#])/i;

function safePosterUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
}

function youtubeVideoId(parsed) {
  if (parsed.hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(parsed.hostname)) {
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || '';
  }
  return '';
}

function vimeoVideoId(parsed) {
  if (!['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(parsed.hostname)) return '';
  const parts = parsed.pathname.split('/').filter(Boolean);
  const candidate = parts[0] === 'video' ? parts[1] : parts[0];
  return /^\d+$/.test(candidate || '') ? candidate : '';
}

function buildLandingTutorialVideo({ url, posterUrl } = {}) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  const poster = safePosterUrl(posterUrl);
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return { type: 'video', src: raw, poster };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const youtubeId = youtubeVideoId(parsed);
  if (/^[A-Za-z0-9_-]{6,}$/.test(youtubeId)) {
    return {
      type: 'embed',
      provider: 'YouTube',
      src: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`
    };
  }

  const vimeoId = vimeoVideoId(parsed);
  if (vimeoId) {
    return {
      type: 'embed',
      provider: 'Vimeo',
      src: `https://player.vimeo.com/video/${vimeoId}?dnt=1`
    };
  }

  if (DIRECT_VIDEO_EXTENSIONS.test(parsed.pathname)) {
    return { type: 'video', src: parsed.toString(), poster };
  }

  return null;
}

module.exports = { buildLandingTutorialVideo };
