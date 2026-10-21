import { Controller, Get, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { statfs } from 'node:fs/promises';
import { ServiceConfig } from '../config';
import { missingMediaTools } from '../media/media-tools';

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'ready'] }) status!: string;
}

@Injectable()
export class ReadinessService {
  private cached?: { ready: boolean; at: number };
  private pending?: Promise<boolean>;
  constructor(private readonly config: ServiceConfig) {}
  async ready() {
    if (this.cached && Date.now() - this.cached.at < 15000) return this.cached.ready;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const results = await Promise.allSettled([
        missingMediaTools(),
        statfs(this.config.directory),
      ]);
      const tools = results[0];
      const disk = results[1];
      const ready = tools.status === 'fulfilled' && tools.value.length === 0 && disk.status === 'fulfilled' && disk.value.bavail * disk.value.bsize > 512 * 1024 * 1024;
      this.cached = { ready, at: Date.now() }; return ready;
    })().finally(() => { this.pending = undefined; });
    return this.pending;
  }
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}
  @Get()
  @ApiOperation({ summary: 'Process liveness' })
  @ApiOkResponse({ type: HealthDto })
  live() { return { status: 'ok' }; }
  @Get('ready')
  @ApiOperation({ summary: 'Check yt-dlp, FFmpeg, FFprobe and available disk space', description: 'Cached for 15 seconds. Does not verify access to any media provider.' })
  @ApiOkResponse({ type: HealthDto })
  @ApiResponse({ status: 503, description: 'Media tools unavailable or less than 512 MiB free disk space.' })
  async ready() {
    if (!(await this.readiness.ready())) throw new ServiceUnavailableException('Media tools unavailable or insufficient disk space.');
    return { status: 'ready' };
  }
}
