const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { buildLandingTutorialVideo } = require('../services/landingTutorialVideoService');

test('landing tutorial accepts self-hosted video and safe poster paths', () => {
  assert.deepEqual(buildLandingTutorialVideo({
    url: '/videos/moyi-cmo-tour.mp4',
    posterUrl: '/images/moyi-tour-poster.webp'
  }), {
    type: 'video',
    src: '/videos/moyi-cmo-tour.mp4',
    poster: '/images/moyi-tour-poster.webp'
  });
});

test('landing tutorial converts supported YouTube and Vimeo links to privacy-aware embeds', () => {
  assert.deepEqual(buildLandingTutorialVideo({ url: 'https://youtu.be/dQw4w9WgXcQ' }), {
    type: 'embed',
    provider: 'YouTube',
    videoId: 'dQw4w9WgXcQ',
    poster: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1'
  });
  assert.deepEqual(buildLandingTutorialVideo({ url: 'https://vimeo.com/123456789' }), {
    type: 'embed',
    provider: 'Vimeo',
    src: 'https://player.vimeo.com/video/123456789?dnt=1'
  });
});

test('landing tutorial rejects unsafe and unsupported URLs', () => {
  assert.equal(buildLandingTutorialVideo({ url: 'javascript:alert(1)' }), null);
  assert.equal(buildLandingTutorialVideo({ url: 'http://example.com/tour.mp4' }), null);
  assert.equal(buildLandingTutorialVideo({ url: 'https://example.com/watch' }), null);
});

test('landing page renders the configured tutorial player and links the demo action to it', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/index.ejs'), {
    appName: 'Moyi-CMO',
    title: 'Moyi-CMO',
    currentUser: null,
    quickScanResult: null,
    quickScanError: '',
    quickScanUrl: '',
    landingTutorialVideo: buildLandingTutorialVideo({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    publicPlans: {
      free: { description: 'Free' },
      starter: { description: 'Starter', monthlyPrice: 49, annualPrice: 490 },
      pro: { description: 'Pro', monthlyPrice: 129, annualPrice: 1290 },
      agency: { description: 'Agency', monthlyPrice: 299, annualPrice: 2990 }
    }
  });

  assert.match(html, /href="#product-tour">View Demo/);
  assert.match(html, /id="product-tour"/);
  assert.match(html, /data-youtube-facade/);
  assert.match(html, /i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/maxresdefault\.jpg/);
  assert.match(html, /data-video-src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(html, /See how Moyi turns evidence into marketing action/);
});
