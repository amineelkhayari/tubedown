import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ServiceConfig } from '../config';
import type { ExtractedFormat, ExtractedMedia, MediaInput, MediaOutput } from './media.types';
import { missingMediaTools, resolveTool } from './media-tools';
import { mediaFailure, MediaProcessingError } from './media-error';

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function resolveCookiesPath(): string | undefined {
  if (process.env.YOUTUBE_COOKIES_PATH && existsSync(process.env.YOUTUBE_COOKIES_PATH)) {
    return process.env.YOUTUBE_COOKIES_PATH;
  }
  if (process.env.COOKIES_PATH && existsSync(process.env.COOKIES_PATH)) {
    return process.env.COOKIES_PATH;
  }
  if (process.env.YOUTUBE_COOKIES) {
    const tmpCookiePath = path.join(os.tmpdir(), 'yt_cookies.txt');
    try {
      writeFileSync(tmpCookiePath, process.env.YOUTUBE_COOKIES, 'utf8');
      return tmpCookiePath;
    } catch {}
  }
  return undefined;
}

export function buildArguments(input: MediaInput, directory: string, maxDuration = 600, maxFilesize = '200M'): string[] {
  const ffmpeg = resolveTool('ffmpeg');
  const audioBitrate = input.audioQuality ? input.audioQuality.toUpperCase() : '128K';
  const cookiesPath = resolveCookiesPath();
  return [
    '--ignore-config', '--no-playlist', '--no-progress', '--no-warnings',
    '--no-cache-dir', '--no-remote-components', '--js-runtimes', `node:${process.execPath}`,
    '--user-agent', DEFAULT_USER_AGENT,
    '--extractor-args', 'youtube:player_client=android,web',
    ...(cookiesPath ? ['--cookies', cookiesPath] : []),
    '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2',
    '--max-filesize', maxFilesize, '--match-filters', `!is_live & duration <= ${maxDuration}`,
    ...(ffmpeg !== 'ffmpeg' ? ['--ffmpeg-location', ffmpeg] : []),
    '--paths', directory, '--output', 'media.%(ext)s',
    ...(input.format === 'mp3'
      ? ['--format', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', audioBitrate]
      : ['--format', `bestvideo[ext=mp4][height<=${input.quality}]+bestaudio[ext=m4a]/best[ext=mp4][height<=${input.quality}]`, '--merge-output-format', 'mp4']),
    '--', input.url,
  ];
}

function formatDuration(sec?: number | null, isLive?: boolean): string {
  if (isLive) return 'LIVE';
  if (!sec || isNaN(sec) || sec <= 0) return '00:00';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatBytes(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

@Injectable()
export class MediaService {
  private checkedAt = 0;
  private checking?: Promise<void>;
  constructor(private readonly config: ServiceConfig) {}
  async ensureTools() {
    if (this.config.runner || Date.now() - this.checkedAt < 15000) return;
    if (this.checking) return this.checking;
    this.checking = (async () => {
      const missing = await missingMediaTools();
      if (missing.length) throw new ServiceUnavailableException(`Unavailable media tools: ${missing.join(', ')}. Install them on the server (Windows: npm run tools:install), then retry.`);
      this.checkedAt = Date.now();
    })().finally(() => { this.checking = undefined; });
    return this.checking;
  }
  async run(input: MediaInput, directory: string, signal: AbortSignal): Promise<MediaOutput> {
    if (this.config.runner) return this.config.runner(input, directory, signal);
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error('Job stopped.'));
      const child = spawn(resolveTool('yt-dlp'), buildArguments(input, directory, this.config.maxDuration, this.config.maxFilesize), {
        shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'],
      });
      const kill = () => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
          else process.kill(-child.pid, 'SIGKILL');
        } catch { /* Already exited. */ }
      };
      signal.addEventListener('abort', kill, { once: true });
      let stderr = '';
      child.stderr!.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384); });
      child.once('error', error => { signal.removeEventListener('abort', kill); reject(error); });
      child.once('close', code => {
        signal.removeEventListener('abort', kill);
        if (signal.aborted) reject(new MediaProcessingError('Download was interrupted or exceeded its processing time limit.'));
        else if (code !== 0) reject(mediaFailure(stderr));
        else resolve();
      });
    });
    const filename = `media.${input.format}`;
    if (!(await readdir(directory)).includes(filename)) throw new MediaProcessingError('No output was produced. Media may exceed the duration or size limit, be live, or require authentication.');
    const size = (await stat(path.join(directory, filename))).size;
    if (size <= 0 || size > 200 * 1024 * 1024) throw new MediaProcessingError('Output is empty or exceeds the 200 MiB limit.');
    return { filename, size };
  }

  async extract(url: string, platform: string, signal?: AbortSignal): Promise<ExtractedMedia> {
    if (this.config.extractRunner) return this.config.extractRunner(url, platform, signal);
    await this.ensureTools();
    const cookiesPath = resolveCookiesPath();
    return new Promise<ExtractedMedia>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Operation aborted.'));
      const child = spawn(resolveTool('yt-dlp'), [
        '--ignore-config', '--no-playlist', '--no-warnings',
        '--ignore-errors',
        '--no-cache-dir', '--no-remote-components',
        '--js-runtimes', `node:${process.execPath}`,
        '--user-agent', DEFAULT_USER_AGENT,
        '--extractor-args', 'youtube:player_client=android,web',
        ...(cookiesPath ? ['--cookies', cookiesPath] : []),
        '--socket-timeout', '15',
        '-J',
        '--', url,
      ], {
        shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
      const kill = () => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
          else process.kill(-child.pid, 'SIGKILL');
        } catch { /* Already exited. */ }
      };
      signal?.addEventListener('abort', kill, { once: true });
      let stdout = '';
      let stderr = '';
      child.stdout!.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr!.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384); });
      child.once('error', error => { signal?.removeEventListener('abort', kill); reject(error); });
      child.once('close', code => {
        signal?.removeEventListener('abort', kill);
        if (signal?.aborted) return reject(new MediaProcessingError('Extraction was interrupted or timed out.'));

        let j: any = null;
        if (stdout.trim()) {
          try { j = JSON.parse(stdout); } catch { /* Fall through to check code */ }
        }

        const entry = j && Array.isArray(j.entries)
          ? j.entries.find((e: any) => e && Array.isArray(e.formats) && e.formats.length > 0) ?? j.entries[0]
          : null;

        const rawFormats: any[] = (j && Array.isArray(j.formats) && j.formats.length)
          ? j.formats
          : (entry && Array.isArray(entry.formats) ? entry.formats : []);

        if (!j || rawFormats.length === 0) {
          if (code !== 0) return reject(mediaFailure(stderr));
          return reject(new MediaProcessingError('Failed to parse media metadata from extractor.'));
        }

        try {
          const parsedFormats: (ExtractedFormat & { _score: number })[] = [];

          for (const f of rawFormats) {
            if (!f || typeof f.url !== 'string' || !f.url.startsWith('http') || f.has_drm) continue;
            const ext = String(f.ext || (f.video_ext && f.video_ext !== 'none' ? 'mp4' : 'm4a')).toLowerCase();

            const isExplicitAudio = f.vcodec === 'none' ||
              f.resolution === 'audio only' ||
              f.url.includes('/mp4a/') ||
              f.url.includes('/aud/') ||
              (f.format_id && String(f.format_id).toLowerCase().includes('audio')) ||
              ['mp3', 'm4a', 'aac', 'wav', 'opus', 'ogg', 'flac'].includes(ext);

            const isExplicitVideo = f.acodec === 'none' || f.resolution === 'video only';

            let hasVideo = false;
            let hasAudio = false;

            if (isExplicitAudio && !f.height && (!f.vcodec || f.vcodec === 'none')) {
              hasVideo = false;
              hasAudio = true;
            } else if (isExplicitVideo && (!f.acodec || f.acodec === 'none')) {
              hasVideo = true;
              hasAudio = false;
            } else {
              const codecVideo = Boolean(f.vcodec && f.vcodec !== 'none');
              const codecAudio = Boolean(f.acodec && f.acodec !== 'none');
              const heightVideo = typeof f.height === 'number' && f.height > 0;
              const abrAudio = typeof f.abr === 'number' && f.abr > 0;

              hasVideo = codecVideo || heightVideo;
              hasAudio = codecAudio || abrAudio;

              if (!hasVideo && !hasAudio) {
                if (['mp4', 'webm', 'mkv', 'mov', '3gp', 'flv', 'm4v', 'ts'].includes(ext)) {
                  hasVideo = true;
                  hasAudio = f.acodec !== 'none';
                } else {
                  hasAudio = true;
                }
              }
            }

            if (!hasVideo && !hasAudio) {
              if (rawFormats.length <= 2) hasVideo = true;
              else continue;
            }

            const type = hasVideo ? 'video' : 'audio';
            let quality = 'default';
            if (hasVideo && f.height) quality = `${f.height}p`;
            else if (!hasVideo && f.abr) quality = `${Math.round(f.abr)}kbps`;
            else if (!hasVideo) quality = 'audio';
            else if (f.format_note) quality = String(f.format_note);
            else if (hasVideo && f.resolution) quality = String(f.resolution);
            else if (hasVideo) quality = 'original';

            const resolution = hasVideo && f.width && f.height ? `${f.width}x${f.height}` : (hasVideo && f.height ? `${f.height}p` : (hasVideo ? f.resolution ?? null : null));
            const filesize = typeof f.filesize === 'number' && f.filesize > 0
              ? f.filesize
              : (typeof f.filesize_approx === 'number' && f.filesize_approx > 0 ? Math.round(f.filesize_approx) : null);

            const isM3u8 = f.url.includes('.m3u8') || (typeof f.protocol === 'string' && f.protocol.startsWith('m3u8'));
            const isDirectHttp = !isM3u8 && (f.url.startsWith('http://') || f.url.startsWith('https://'));

            const heightBonus = hasVideo && f.height ? Number(f.height) * 2 : 0;
            const directBonus = isDirectHttp ? 500 : 0;
            const score = (hasVideo && hasAudio ? 1000 : 0) +
              directBonus +
              heightBonus +
              (ext === 'mp4' ? 50 : 0) +
              (f.tbr ?? f.abr ?? 0);

            const headers = (f.http_headers && typeof f.http_headers === 'object') ? f.http_headers : (j.http_headers && typeof j.http_headers === 'object') ? j.http_headers : undefined;
            const cookies = typeof f.cookies === 'string' ? f.cookies : (typeof j.cookies === 'string' ? j.cookies : undefined);

            parsedFormats.push({
              formatId: String(f.format_id ?? ''),
              type,
              quality,
              resolution,
              ext: isM3u8 && !hasVideo ? 'm3u8' : ext,
              height: typeof f.height === 'number' ? f.height : null,
              width: typeof f.width === 'number' ? f.width : null,
              fps: typeof f.fps === 'number' ? f.fps : null,
              filesize,
              filesizeFormatted: formatBytes(filesize),
              hasVideo,
              hasAudio,
              protocol: typeof f.protocol === 'string' ? f.protocol : undefined,
              url: f.url,
              httpHeaders: headers,
              cookies,
              _score: score
            });
          }

          // Deduplicate by (type, quality, ext) keeping highest score
          const formatMap = new Map<string, ExtractedFormat & { _score: number }>();
          for (const item of parsedFormats) {
            const key = `${item.type}:${item.quality}:${item.ext}`;
            const existing = formatMap.get(key);
            if (!existing || item._score > existing._score) {
              formatMap.set(key, item);
            }
          }

          const cleanMedias = Array.from(formatMap.values())
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
              return b._score - a._score;
            })
            .map(({ _score, ...rest }) => rest as ExtractedFormat);

          const videoFormats = cleanMedias.filter(m => m.hasVideo);
          const bestVideo = videoFormats.find(m => m.hasAudio && !m.url.includes('.m3u8')) ??
                            videoFormats.find(m => !m.url.includes('.m3u8')) ??
                            videoFormats.find(m => m.hasAudio) ??
                            videoFormats[0];

          const audioFormats = cleanMedias.filter(m => m.hasAudio);
          const bestAudio = audioFormats.find(m => m.type === 'audio' && !m.url.includes('.m3u8')) ??
                            audioFormats.find(m => m.type === 'audio') ??
                            audioFormats.find(m => !m.url.includes('.m3u8')) ??
                            audioFormats[0];

          const isLive = Boolean(j.is_live || j.live_status === 'is_live' || (entry && (entry.is_live || entry.live_status === 'is_live')));
          const dur = typeof j.duration === 'number' ? j.duration : (entry && typeof entry.duration === 'number' ? entry.duration : null);
          const durationNum = typeof dur === 'number' && !isLive ? Math.round(dur) : 0;
          const authorName = String(j.uploader ?? j.channel ?? j.creator ?? entry?.uploader ?? entry?.creator ?? 'Unknown');
          const username = j.uploader_id ? String(j.uploader_id) : (entry?.uploader_id ? String(entry.uploader_id) : null);
          const authorUrl = j.uploader_url ? String(j.uploader_url) : (entry?.uploader_url ? String(entry.uploader_url) : null);
          const thumbnail = typeof j.thumbnail === 'string'
            ? j.thumbnail
            : (Array.isArray(j.thumbnails) && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : (entry?.thumbnail ?? null));
          const title = String(j.title ?? j.fulltitle ?? entry?.title ?? entry?.fulltitle ?? 'Media');
          const description = typeof j.description === 'string' ? j.description.slice(0, 1000) : (entry && typeof entry.description === 'string' ? entry.description.slice(0, 1000) : null);

          const rootHeaders = (j.http_headers && typeof j.http_headers === 'object') ? j.http_headers : undefined;

          resolve({
            id: String(j.id ?? entry?.id ?? ''),
            platform,
            title,
            description,
            thumbnail,
            duration: durationNum,
            durationFormatted: formatDuration(durationNum, isLive),
            author: {
              name: authorName,
              username,
              url: authorUrl
            },
            uploader: authorName,
            download: {
              video: bestVideo?.url ?? null,
              audio: bestAudio?.url ?? null
            },
            medias: cleanMedias,
            formats: cleanMedias,
            bestVideo,
            bestAudio,
            httpHeaders: rootHeaders,
            isLive
          });
        } catch {
          reject(new MediaProcessingError('Failed to parse media metadata from extractor.'));
        }
      });
    });
  }
}
