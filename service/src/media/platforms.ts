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
    example: 'https://www.dailymotion.com/video/x84sh87', notes: 'Public single videos.',
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
    example: 'https://www.twitch.tv/videos/1234567890', notes: 'Public recordings and clips within the duration limit; no live streams or subscriber-only media.',
    canonical: url => {
      if (url.hostname === 'clips.twitch.tv' && /^\/[\w-]+$/.test(url.pathname)) return `https://clips.twitch.tv${url.pathname}`;
      return /^\/(?:videos\/\d+|[\w]+\/clip\/[\w-]+)\/?$/.test(url.pathname) ? `https://www.twitch.tv${url.pathname}` : undefined;
    },
  },
  {
    id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com', 'www.soundcloud.com'], formats: ['mp3'],
    example: 'https://soundcloud.com/artist/track', notes: 'Public individual tracks, MP3 only; no sets, private tracks, or paid content.',
    canonical: url => /^\/(?!discover\/|charts\/|search\/)[\w-]+\/(?!sets(?:\/|$)|tracks(?:\/|$)|albums(?:\/|$)|likes(?:\/|$)|reposts(?:\/|$))[\w-]+\/?$/.test(url.pathname) ? `https://soundcloud.com${url.pathname}` : undefined,
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
  return { ...input, url: canonical, platform };
}

