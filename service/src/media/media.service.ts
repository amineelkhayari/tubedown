import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ServiceConfig } from '../config';
import type { ExtractedFormat, ExtractedMedia, MediaInput, MediaOutput } from './media.types';
import { missingMediaTools, resolveTool } from './media-tools';
import { mediaFailure, MediaProcessingError } from './media-error';

export function buildArguments(input: MediaInput, directory: string, maxDuration = 600, maxFilesize = '200M'): string[] {
  const ffmpeg = resolveTool('ffmpeg');
  const audioBitrate = input.audioQuality ? input.audioQuality.toUpperCase() : '128K';
  return [
    '--ignore-config', '--no-playlist', '--no-progress', '--no-warnings',
    '--no-cache-dir', '--no-remote-components', '--js-runtimes', `node:${process.execPath}`,
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

function formatDuration(sec?: number | null): string {
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
    return new Promise<ExtractedMedia>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Operation aborted.'));
      const child = spawn(resolveTool('yt-dlp'), [
        '--ignore-config', '--no-playlist', '--no-warnings',
        '--no-cache-dir', '--no-remote-components',
        '--js-runtimes', `node:${process.execPath}`,
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
        if (signal?.aborted) reject(new MediaProcessingError('Extraction was interrupted or timed out.'));
        else if (code !== 0) reject(mediaFailure(stderr));
        else {
          try {
            const j = JSON.parse(stdout);
            const rawFormats: any[] = Array.isArray(j.formats) ? j.formats : [];
            const parsedFormats: (ExtractedFormat & { _score: number })[] = [];

            for (const f of rawFormats) {
              if (!f || typeof f.url !== 'string' || !f.url.startsWith('http') || f.has_drm) continue;
              const hasVideo = Boolean((f.vcodec && f.vcodec !== 'none') || (typeof f.height === 'number' && f.height > 0));
              const hasAudio = Boolean((f.acodec && f.acodec !== 'none') || (Boolean(f.abr) && !hasVideo));
              if (!hasVideo && !hasAudio) continue;

              const type = hasVideo ? 'video' : 'audio';
              let quality = 'default';
              if (hasVideo && f.height) quality = `${f.height}p`;
              else if (!hasVideo && f.abr) quality = `${Math.round(f.abr)}kbps`;
              else if (!hasVideo) quality = 'audio';
              else if (f.format_note) quality = String(f.format_note);

              const ext = String(f.ext || (hasVideo ? 'mp4' : 'm4a')).toLowerCase();
              const resolution = hasVideo && f.width && f.height ? `${f.width}x${f.height}` : (hasVideo && f.height ? `${f.height}p` : null);
              const filesize = typeof f.filesize === 'number' && f.filesize > 0
                ? f.filesize
                : (typeof f.filesize_approx === 'number' && f.filesize_approx > 0 ? Math.round(f.filesize_approx) : null);

              parsedFormats.push({
                formatId: String(f.format_id ?? ''),
                type,
                quality,
                resolution,
                ext,
                height: typeof f.height === 'number' ? f.height : null,
                width: typeof f.width === 'number' ? f.width : null,
                fps: typeof f.fps === 'number' ? f.fps : null,
                filesize,
                filesizeFormatted: formatBytes(filesize),
                hasVideo,
                hasAudio,
                protocol: typeof f.protocol === 'string' ? f.protocol : undefined,
                url: f.url,
                _score: (hasVideo && hasAudio ? 1000 : 0) + (ext === 'mp4' ? 50 : 0) + (f.tbr ?? 0)
              });
            }

            // Deduplicate by (type, quality, ext) keeping highest score
            const formatMap = new Map<string, ExtractedFormat>();
            for (const item of parsedFormats) {
              const key = `${item.type}:${item.quality}:${item.ext}`;
              const existing = formatMap.get(key) as (ExtractedFormat & { _score?: number }) | undefined;
              if (!existing || item._score > (existing._score ?? 0)) {
                formatMap.set(key, item);
              }
            }

            const cleanMedias = Array.from(formatMap.values())
              .map(({ _score, ...rest }: any) => rest as ExtractedFormat)
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
                const hA = parseInt(a.quality) || 0;
                const hB = parseInt(b.quality) || 0;
                return hB - hA;
              });

            const bestVideo = cleanMedias.find(m => m.hasVideo && m.hasAudio) ?? cleanMedias.find(m => m.hasVideo);
            const bestAudio = cleanMedias.find(m => m.type === 'audio') ?? cleanMedias.find(m => m.hasAudio);

            const durationNum = typeof j.duration === 'number' ? Math.round(j.duration) : 0;
            const authorName = String(j.uploader ?? j.channel ?? j.creator ?? 'Unknown');
            const username = j.uploader_id ? String(j.uploader_id) : null;
            const authorUrl = j.uploader_url ? String(j.uploader_url) : null;
            const thumbnail = typeof j.thumbnail === 'string'
              ? j.thumbnail
              : (Array.isArray(j.thumbnails) && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : null);

            resolve({
              id: String(j.id ?? ''),
              platform,
              title: String(j.title ?? j.fulltitle ?? 'Media'),
              description: typeof j.description === 'string' ? j.description.slice(0, 1000) : null,
              thumbnail,
              duration: durationNum,
              durationFormatted: formatDuration(durationNum),
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
              bestAudio
            });
          } catch {
            reject(new MediaProcessingError('Failed to parse media metadata from extractor.'));
          }
        }
      });
    });
  }
}


