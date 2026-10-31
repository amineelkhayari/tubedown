import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Post, Query, Req, Res, UnsupportedMediaTypeException, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiExcludeEndpoint, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { ServiceConfig } from '../config';
import { CreateDownloadDto, ErrorDto, FallbackMediaDto } from '../downloads/download.dto';
import { DownloadsService, publicJob } from '../downloads/downloads.service';
import { MediaService } from '../media/media.service';
import { normalizeExtract, normalizeMedia } from '../media/platforms';

export class FallbackInfoDto {
  status!: string;
  strategies!: string[];
  description!: string;
}

@ApiTags('Fallback & Streaming')
@Controller()
export class FallbackController {
  constructor(
    private readonly config: ServiceConfig,
    private readonly media: MediaService,
    private readonly downloads: DownloadsService,
  ) {}

  @Get('v1/fallback')
  @ApiOperation({
    summary: 'Fallback strategy details',
    description: 'Returns available fallback processing strategies and controller status.',
  })
  @ApiOkResponse({ type: FallbackInfoDto })
  info(): FallbackInfoDto {
    return {
      status: 'ready',
      strategies: ['extract', 'job', 'stream-proxy'],
      description: 'Smart fallback pipeline: attempts instant CDN extraction first; if direct access is restricted or unsupported, automatically falls back to an asynchronous server transcode job. Includes /v1/stream proxy to bypass CDN hotlink protections.',
    };
  }

  @Post('v1/fallback')
  @HttpCode(200)
  @ApiBearerAuth('direct-key')
  @UseGuards(AuthGuard, RateLimitGuard)
  @ApiOperation({
    summary: 'Smart extraction with automatic transcode job fallback',
    description: 'Attempts instant direct CDN extraction first (1–2s). If direct streaming is protected (e.g. TikTok Akamai CDN hotlink blocks), unavailable, or fails, seamlessly falls back to creating an asynchronous server transcode job.',
  })
  @ApiHeader({ name: 'Content-Type', required: true, schema: { type: 'string', default: 'application/json' } })
  @ApiAcceptedResponse({ type: FallbackMediaDto })
  @ApiBadRequestResponse({ type: ErrorDto })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: 'Missing or invalid credentials.' })
  @ApiResponse({ status: 413, type: ErrorDto, description: 'Body exceeds 4 KiB.' })
  @ApiResponse({ status: 415, type: ErrorDto, description: 'Content-Type must be application/json.' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'Submission limit reached.' })
  @ApiResponse({ status: 503, type: ErrorDto, description: 'Media executables are missing or unavailable on the server.' })
  async fallback(
    @Body() dto: CreateDownloadDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FallbackMediaDto> {
    if (!req.is('application/json')) throw new UnsupportedMediaTypeException('Use application/json.');
    const input = normalizeMedia(dto);
    const { url, platform } = normalizeExtract(dto.url);
    await this.media.ensureTools();

    // Platforms with known CDN hotlinking blocks (e.g. TikTok Akamai video) fall back directly to server transcode for MP4
    if (platform === 'tiktok' && input.format === 'mp4') {
      const job = await this.downloads.create(req.owner, input);
      res.setHeader('Location', `/v1/jobs/${job.id}`);
      return {
        mode: 'job',
        job: publicJob(job),
        message: 'Direct extraction skipped: TikTok Akamai CDN blocks direct browser video downloads. Created server transcode job.',
      };
    }

    // Attempt instant direct extraction first
    try {
      const extractResult = await this.media.extract(url, platform);
      if (extractResult && (extractResult.download?.video || extractResult.download?.audio || (extractResult.medias && extractResult.medias.length > 0))) {
        return {
          mode: 'extract',
          extract: extractResult,
          message: 'Instant direct CDN streaming links extracted successfully.',
        };
      }
    } catch (_extractError) {
      // Fall through to server-side job fallback below
    }

    // Direct extraction failed or produced no streams: Fallback to server transcoding job
    const job = await this.downloads.create(req.owner, input);
    res.setHeader('Location', `/v1/jobs/${job.id}`);
    return {
      mode: 'job',
      job: publicJob(job),
      message: 'Direct extraction fallback triggered: created server transcode job for reliable media delivery.',
    };
  }

  @Get('v1/stream')
  @ApiOperation({
    summary: 'Streaming proxy to bypass CDN hotlink protections and CORS blocks',
    description: 'Proxies video/audio streaming directly from provider CDNs with provider-specific Referer and User-Agent headers, supporting HTTP 206 Range requests for seamless HTML5 video playback.',
  })
  @ApiQuery({ name: 'url', required: true, description: 'Direct CDN media stream URL to proxy' })
  @ApiQuery({ name: 'platform', required: false, description: 'Origin platform ID (e.g. instagram, tiktok, youtube)' })
  @ApiResponse({ status: 200, description: 'Full media binary stream' })
  @ApiResponse({ status: 206, description: 'Partial media chunk stream with Content-Range' })
  async streamMedia(
    @Query('url') rawUrl: string,
    @Query('platform') platform: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new BadRequestException('Target stream URL parameter is required.');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid stream URL.');
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new BadRequestException('Only HTTP/HTTPS URLs are supported.');
    }

    // SSRF protection: reject localhost, loopback, and private IP ranges
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('169.254.')
    ) {
      throw new BadRequestException('Access to private/local destinations is forbidden.');
    }

    // Build headers based on platform or target hostname
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // Set appropriate Referer and Origin based on platform / destination
    if (platform === 'instagram' || hostname.includes('cdninstagram') || hostname.includes('fbcdn')) {
      headers['Referer'] = 'https://www.instagram.com/';
      headers['Origin'] = 'https://www.instagram.com';
    } else if (platform === 'tiktok' || hostname.includes('tiktok')) {
      headers['Referer'] = 'https://www.tiktok.com/';
    } else if (platform === 'youtube' || hostname.includes('googlevideo')) {
      headers['Referer'] = 'https://www.youtube.com/';
    } else if (platform === 'twitter' || hostname.includes('twimg')) {
      headers['Referer'] = 'https://x.com/';
    } else if (platform === 'soundcloud' || hostname.includes('sndcdn')) {
      headers['Referer'] = 'https://soundcloud.com/';
    } else if (platform === 'vimeo' || hostname.includes('vimeocdn')) {
      headers['Referer'] = 'https://vimeo.com/';
    } else if (platform === 'twitch' || hostname.includes('ttvnw')) {
      headers['Referer'] = 'https://www.twitch.tv/';
    }

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    try {
      const upstream = await fetch(parsedUrl.href, {
        headers,
        signal: abortController.signal,
        redirect: 'follow',
      });

      if (!upstream.ok && upstream.status !== 206) {
        throw new BadGatewayException(`Upstream CDN returned HTTP ${upstream.status}`);
      }

      const responseHeaders: Record<string, string> = {
        'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      };

      const contentLength = upstream.headers.get('content-length');
      if (contentLength) responseHeaders['Content-Length'] = contentLength;

      const contentRange = upstream.headers.get('content-range');
      if (contentRange) responseHeaders['Content-Range'] = contentRange;

      res.writeHead(upstream.status, responseHeaders);

      if (upstream.body) {
        Readable.fromWeb(upstream.body as any).pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (!res.headersSent) {
        throw new BadGatewayException(`Failed to stream media: ${err.message}`);
      }
    }
  }

  @Get('{*splat}')
  @ApiExcludeEndpoint()
  handleSpaFallback(@Req() req: Request, @Res() res: Response) {
    if (
      req.path.startsWith('/v1/') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/docs') ||
      req.path.startsWith('/openapi') ||
      req.headers['accept']?.includes('application/json')
    ) {
      throw new NotFoundException(`Route ${req.method} ${req.path} not found`);
    }

    const htmlPath = path.join(this.config.publicDirectory, 'index.html');
    return res.sendFile(htmlPath);
  }
}
