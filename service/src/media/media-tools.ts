import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const toolRoot = path.resolve(__dirname, '../../tools');
const executable = (name: string) => process.platform === 'win32' ? `${name}.exe` : name;

export function resolveTool(name: 'yt-dlp' | 'ffmpeg' | 'ffprobe'): string {
  const configured = process.env[{ 'yt-dlp': 'YTDLP_PATH', ffmpeg: 'FFMPEG_PATH', ffprobe: 'FFPROBE_PATH' }[name]];
  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : /[/\\]/.test(configured) ? path.resolve(__dirname, '../..', configured) : configured;
    return existsSync(resolved) && statSync(resolved).isDirectory() ? path.join(resolved, executable(name)) : resolved;
  }
  if (name === 'ffprobe' && process.env.FFMPEG_PATH) {
    const ffmpeg = resolveTool('ffmpeg');
    const sibling = path.join(path.dirname(ffmpeg), executable('ffprobe'));
    if (existsSync(sibling)) return sibling;
  }
  const local = path.join(toolRoot, executable(name));
  return existsSync(local) ? local : name;
}

export async function missingMediaTools(): Promise<string[]> {
  const names = ['yt-dlp', 'ffmpeg', 'ffprobe'] as const;
  const results = await Promise.allSettled(names.map(name => execute(resolveTool(name), [name === 'yt-dlp' ? '--version' : '-version'], { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 })));
  return names.filter((_name, i) => results[i].status === 'rejected');
}
