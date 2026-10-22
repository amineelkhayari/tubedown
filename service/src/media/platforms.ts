import { BadRequestException } from '@nestjs/common';
import type { AudioBitrate, MediaInput, OutputFormat } from './media.types';

interface PlatformRule {
  id: string; name: string; hosts: string[]; example: string; notes: string;
  formats: OutputFormat[]; canonical: (url: URL) => string | undefined;
}
const videoFormats: OutputFormat[] = ['mp4', 'mp3'];
export const PLATFORM_RULES: PlatformRule[] = [
  {
    id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
    formats: videoFormats, example: 'https://www.youtube.com/watch?v=BaW_jenozKc', notes: 'Single videos and Shorts. No playlists or live streams.',
    canonical: url => {
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
      return /^[\w-]{11}$/.test(id ?? '') ? `https://www.youtube.com/watch?v=${id}` : undefined;
    },
  },
  {
    id: 'vimeo', name: 'Vimeo', hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'], formats: videoFormats,
    example: 'https://vimeo.com/76979871', notes: 'Public single videos; password-protected and private videos are excluded.',
    canonical: url => { const id = /^\/(?:video\/)?(\d+)\/?$/.exec(url.pathname)?.[1]; return id ? `https://vimeo.com/${id}` : undefined; },
  },
  {
    id: 'dailymotion', name: 'Dailymotion', hosts: ['dailymotion.com', 'www.dailymotion.com', 'dai.ly'], formats: videoFormats,
    example: 'https://dailymotion.com/video/x84sh87', notes: 'Public single videos.',
    canonical: url => { const id = /^\/(?:video\/)?([a-zA-Z0-9]+)\/?$/.exec(url.pathname)?.[1]; return id ? `https://www.dailymotion.com/video/${id}` : undefined; },
  },
  {
    id: 'tiktok', name: 'TikTok', hosts: ['tiktok.com', 'www.tiktok.com'], formats: videoFormats,
    example: 'https://www.tiktok.com/@creator/video/1234567890123456789', notes: 'Full public video URLs; vm/vt short links and profiles are excluded.',
    canonical: url => /^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname) ? `https://www.tiktok.com${url.pathname}` : undefined,
  },
  {
    id: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'www.instagram.com'], formats: videoFormats,
    example: 'https://www.instagram.com/reel/EXAMPLE123/', notes: 'Public reels and video posts. Login requirements may prevent extraction; no stories or photo carousels.',
    canonical: url => /^\/(?:reel|p)\/[\w-]+\/?$/.test(url.pathname) ? `https://www.instagram.com${url.pathname}` : undefined,
  },
  {
    id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com'], formats: videoFormats,
    example: 'https://www.facebook.com/watch/?v=1234567890', notes: 'Public watch/videos/reel links. No private groups, login cookies, or fb.watch short links.',
    canonical: url => {
      const id = /^\/(?:watch\/?)?$/.test(url.pathname) ? url.searchParams.get('v') : /^\/(?:[^/]+\/videos|reel)\/(\d+)\/?$/.exec(url.pathname)?.[1];
      return /^\d+$/.test(id ?? '') ? `https://www.facebook.com/watch/?v=${id}` : undefined;
    },
  },
  {
    id: 'twitter', name: 'X / Twitter', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], formats: videoFormats,
    example: 'https://x.com/creator/status/1234567890123456789', notes: 'Public posts containing video. Protected accounts and login-only content are excluded.',
    canonical: url => { const match = /^\/([\w]+)\/status\/(\d+)\/?$/.exec(url.pathname); return match ? `https://x.com/${match[1]}/status/${match[2]}` : undefined; },
  },
  {
    id: 'twitch', name: 'Twitch', hosts: ['twitch.tv', 'www.twitch.tv', 'clips.twitch.tv'], formats: videoFormats,
    example: 'https://twitch.tv/videos/1234567890', notes: 'Public recordings, clips, and live streams for extraction. Server file downloads exclude live streams.',
    canonical: url => {
      if (url.hostname === 'clips.twitch.tv' && /^\/[\w-]+$/.test(url.pathname)) return `https://clips.twitch.tv${url.pathname}`;
      if (/^\/(?:videos\/\d+|[\w]+\/clip\/[\w-]+)\/?$/.test(url.pathname)) return `https://www.twitch.tv${url.pathname}`;
      const cleanPath = url.pathname.replace(/\/+$/, '');
      const match = /^\/([a-zA-Z0-9_]{3,25})$/.exec(cleanPath);
      const reserved = ['directory', 'downloads', 'jobs', 'settings', 'wallet', 'subscriptions', 'turbo', 'prime', 'videos', 'clip', 'p'];
      if (match && !reserved.includes(match[1].toLowerCase())) {
        return `https://www.twitch.tv/${match[1]}`;
      }
      return undefined;
    },
  },
  {
    id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com'], formats: ['mp3'],
    example: 'https://soundcloud.com/artist/track', notes: 'Public tracks and sets, MP3 only; supports mobile on.soundcloud.com short links.',
    canonical: url => {
      if (url.hostname === 'on.soundcloud.com' && /^\/[\w-]+$/.test(url.pathname)) {
        return `https://on.soundcloud.com${url.pathname}`;
      }
      const cleanPath = url.pathname.replace(/\/+$/, '');
      const reserved = ['discover', 'charts', 'search', 'you', 'stream', 'upload', 'settings', 'messages', 'feed', 'terms-of-use', 'popular', 'pages', 'imprint'];
      const segments = cleanPath.split('/').filter(Boolean);
      if (segments.length < 2 || segments.length > 4 || reserved.includes(segments[0].toLowerCase())) {
        return undefined;
      }
      return `https://soundcloud.com${cleanPath}`;
    },
  },
  {
    id: 'snapchat', name: 'Snapchat', hosts: ['snapchat.com', 'www.snapchat.com', 'story.snapchat.com', 't.snapchat.com'], formats: videoFormats,
    example: 'https://www.snapchat.com/@creator/spotlight/1234567890', notes: 'Public Spotlight videos and stories.',
    canonical: url => {
      if (url.hostname === 't.snapchat.com' && /^\/[\w-]+$/.test(url.pathname)) return `https://t.snapchat.com${url.pathname}`;
      const cleanPath = url.pathname.replace(/\/+$/, '');
      const match = /^\/(?:@[\w.-]+\/)?(?:spotlight|p)\/([\w-]+)$/.exec(cleanPath);
      return match ? `https://www.snapchat.com${cleanPath}` : undefined;
    },
  },
];

export function platforms() {
  return PLATFORM_RULES.map(({ canonical: _canonical, ...info }) => ({ ...info, status: 'enabled' as const, liveVerified: false }));
}

export function normalizeExtract(urlStr: string): { url: string; platform: string } {
  let url: URL;
  try { url = new URL(urlStr); } catch { throw new BadRequestException('Provide a valid HTTPS media URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new BadRequestException('Use a public HTTPS URL without credentials or a custom port.');
  const rule = PLATFORM_RULES.find(platform => platform.hosts.includes(url.hostname));
  const canonical = rule?.canonical(url);
  if (!rule || !canonical) throw new BadRequestException('Unsupported media URL. See GET /v1/platforms for accepted sites and link types.');
  return { url: canonical, platform: rule.id };
}

export function normalizeMedia(input: { url: string; format: OutputFormat; quality: number; audioQuality?: AudioBitrate }): MediaInput {
  const { url: canonical, platform } = normalizeExtract(input.url);
  const rule = PLATFORM_RULES.find(p => p.id === platform)!;
  if (!rule.formats.includes(input.format)) throw new BadRequestException(`${rule.name} supports ${rule.formats.join(', ')} output only.`);
  if (platform === 'twitch') {
    const parsed = new URL(canonical);
    if (!/^\/(?:videos\/\d+|[\w]+\/clip\/[\w-]+)/.test(parsed.pathname) && parsed.hostname !== 'clips.twitch.tv') {
      throw new BadRequestException('Twitch live streams cannot be downloaded as server files. Use POST /v1/extract for live HLS streams.');
    }
  }
  if (platform === 'soundcloud' && /\/sets(?:\/|$)/.test(canonical)) {
    throw new BadRequestException('SoundCloud sets/playlists cannot be downloaded as single server files. Use POST /v1/extract or provide an individual track URL.');
  }
  return { ...input, url: canonical, platform };
}
