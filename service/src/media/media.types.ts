export type OutputFormat = 'mp4' | 'mp3';
export type AudioBitrate = '128k' | '192k' | '256k' | '320k';
export interface MediaInput { url: string; format: OutputFormat; quality: number; audioQuality?: AudioBitrate; platform: string; }
export interface MediaOutput { filename: string; size: number; }
export type MediaRunner = (input: MediaInput, directory: string, signal: AbortSignal) => Promise<MediaOutput>;

export interface MediaAuthor {
  name: string;
  username?: string | null;
  url?: string | null;
}

export interface DownloadShortcuts {
  video?: string | null;
  audio?: string | null;
}

export interface ExtractedFormat {
  formatId: string;
  type: 'video' | 'audio';
  quality: string;
  resolution?: string | null;
  ext: string;
  height?: number | null;
  width?: number | null;
  fps?: number | null;
  filesize?: number | null;
  filesizeFormatted?: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  protocol?: string;
  url: string;
  httpHeaders?: Record<string, string>;
  cookies?: string;
}

export interface ExtractedMedia {
  id: string;
  platform: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  duration: number;
  durationFormatted: string;
  author: MediaAuthor;
  uploader?: string;
  download: DownloadShortcuts;
  medias: ExtractedFormat[];
  formats: ExtractedFormat[];
  bestVideo?: ExtractedFormat;
  bestAudio?: ExtractedFormat;
  httpHeaders?: Record<string, string>;
  isLive?: boolean;
}

export type ExtractRunner = (url: string, platform: string, signal?: AbortSignal) => Promise<ExtractedMedia>;
