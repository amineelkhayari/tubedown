import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import type { AudioBitrate, OutputFormat } from '../media/media.types';

export class CreateDownloadDto {
  @ApiProperty({ example: 'https://www.youtube.com/watch?v=BaW_jenozKc', maxLength: 2048, description: 'Public single-media HTTPS URL from GET /v1/platforms.' })
  @IsString() @MaxLength(2048) @IsUrl({ protocols: ['https'], require_protocol: true, require_valid_protocol: true })
  url!: string;

  @ApiPropertyOptional({ enum: ['mp4', 'mp3'], default: 'mp4' })
  @IsOptional() @IsIn(['mp4', 'mp3'])
  format: OutputFormat = 'mp4';

  @ApiPropertyOptional({ enum: [144, 240, 360, 480, 720, 1080, 1440, 2160], default: 720, description: 'Maximum video height (144p to 4K). Ignored for MP3.' })
  @IsOptional() @IsInt() @IsIn([144, 240, 360, 480, 720, 1080, 1440, 2160])
  quality = 720;

  @ApiPropertyOptional({ enum: ['128k', '192k', '256k', '320k'], default: '128k', description: 'Audio bitrate for MP3.' })
  @IsOptional() @IsIn(['128k', '192k', '256k', '320k'])
  audioQuality: AudioBitrate = '128k';
}

export class ExtractMediaDto {
  @ApiProperty({ example: 'https://www.youtube.com/watch?v=BaW_jenozKc', maxLength: 2048, description: 'Public media HTTPS URL.' })
  @IsString() @MaxLength(2048) @IsUrl({ protocols: ['https'], require_protocol: true, require_valid_protocol: true })
  url!: string;
}

export class MediaAuthorDto {
  @ApiProperty({ example: 'Creator Name' }) name!: string;
  @ApiPropertyOptional({ example: '@creator', nullable: true }) username?: string | null;
  @ApiPropertyOptional({ example: 'https://...', nullable: true }) url?: string | null;
}

export class DownloadShortcutsDto {
  @ApiPropertyOptional({ example: 'https://...', nullable: true }) video?: string | null;
  @ApiPropertyOptional({ example: 'https://...', nullable: true }) audio?: string | null;
}

export class MediaFormatDto {
  @ApiProperty({ example: '137' }) formatId!: string;
  @ApiProperty({ enum: ['video', 'audio'], example: 'video' }) type!: 'video' | 'audio';
  @ApiProperty({ example: '1080p' }) quality!: string;
  @ApiPropertyOptional({ example: '1920x1080', nullable: true }) resolution?: string | null;
  @ApiProperty({ example: 'mp4' }) ext!: string;
  @ApiPropertyOptional({ example: 1080, nullable: true }) height?: number | null;
  @ApiPropertyOptional({ example: 1920, nullable: true }) width?: number | null;
  @ApiPropertyOptional({ example: 30, nullable: true }) fps?: number | null;
  @ApiPropertyOptional({ example: 15482900, nullable: true }) filesize?: number | null;
  @ApiPropertyOptional({ example: '14.8 MB', nullable: true }) filesizeFormatted?: string | null;
  @ApiProperty({ example: true }) hasVideo!: boolean;
  @ApiProperty({ example: true }) hasAudio!: boolean;
  @ApiPropertyOptional({ example: 'https' }) protocol?: string;
  @ApiProperty({ example: 'https://...' }) url!: string;
}

export class ExtractedMediaDto {
  @ApiProperty({ example: 'jNQXAC9IVRw' }) id!: string;
  @ApiProperty({ example: 'youtube' }) platform!: string;
  @ApiProperty({ example: 'Sample Video Title' }) title!: string;
  @ApiPropertyOptional({ example: 'Sample description', nullable: true }) description?: string | null;
  @ApiPropertyOptional({ example: 'https://i.ytimg.com/vi/...', nullable: true }) thumbnail?: string | null;
  @ApiProperty({ example: 19 }) duration!: number;
  @ApiProperty({ example: '00:19' }) durationFormatted!: string;
  @ApiProperty({ type: MediaAuthorDto }) author!: MediaAuthorDto;
  @ApiPropertyOptional({ example: 'Creator Name' }) uploader?: string;
  @ApiProperty({ type: DownloadShortcutsDto }) download!: DownloadShortcutsDto;
  @ApiProperty({ type: [MediaFormatDto] }) medias!: MediaFormatDto[];
  @ApiProperty({ type: [MediaFormatDto], description: 'Alias for medias array' }) formats!: MediaFormatDto[];
  @ApiPropertyOptional({ type: MediaFormatDto }) bestVideo?: MediaFormatDto;
  @ApiPropertyOptional({ type: MediaFormatDto }) bestAudio?: MediaFormatDto;
}


export class DownloadDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'] }) status!: string;
  @ApiProperty({ enum: ['mp4', 'mp3'] }) format!: string;
  @ApiProperty() platform!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt!: string | null;
  @ApiPropertyOptional() error?: string;
  @ApiPropertyOptional({ description: 'Output size in bytes.' }) size?: number;
  @ApiPropertyOptional() downloadPath?: string;
}

export class ErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() error!: string;
}

