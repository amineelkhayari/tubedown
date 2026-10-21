import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, StreamableFile, UnsupportedMediaTypeException, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { normalizeMedia } from '../media/platforms';
import { MediaService } from '../media/media.service';
import { CreateDownloadDto, DownloadDto, ErrorDto } from './download.dto';
import { DownloadsService, publicJob } from './downloads.service';

@ApiTags('Downloads')
@ApiBearerAuth('direct-key')
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Missing or invalid credentials.' })
@UseGuards(AuthGuard)
@Controller('v1/jobs')
export class DownloadsController {
  constructor(private readonly downloads: DownloadsService, private readonly media: MediaService) {}

  @Post()
  @HttpCode(202)
  @UseGuards(RateLimitGuard)
  @ApiOperation({ summary: 'Create a video or audio download', description: 'Returns immediately. Poll the status endpoint every three seconds. Maximum duration: 10 minutes; output: 200 MiB. Five submissions/minute, three active jobs per consumer.' })
  @ApiHeader({ name: 'Content-Type', required: true, schema: { type: 'string', default: 'application/json' } })
  @ApiAcceptedResponse({ type: DownloadDto })
  @ApiBadRequestResponse({ type: ErrorDto })
  @ApiResponse({ status: 413, type: ErrorDto, description: 'Body exceeds 4 KiB.' })
  @ApiResponse({ status: 415, type: ErrorDto, description: 'Content-Type must be application/json.' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'Submission or queue limit reached.' })
  @ApiResponse({ status: 503, type: ErrorDto, description: 'Media executables are missing or unavailable on the server.' })
  async create(@Body() dto: CreateDownloadDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.is('application/json')) throw new UnsupportedMediaTypeException('Use application/json.');
    const input = normalizeMedia(dto);
    await this.media.ensureTools();
    const job = await this.downloads.create(req.owner, input);
    res.setHeader('Location', `/v1/jobs/${job.id}`);
    return publicJob(job);
  }

  @Get()
  @ApiOperation({ summary: 'List your latest 100 unexpired jobs' })
  @ApiOkResponse({ type: DownloadDto, isArray: true })
  list(@Req() req: AuthenticatedRequest) { return this.downloads.list(req.owner); }

  @Get(':id')
  @ApiOperation({ summary: 'Read download status' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DownloadDto })
  @ApiNotFoundResponse({ type: ErrorDto, description: 'Unknown, expired, or belongs to another consumer.' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return publicJob(this.downloads.get(id, req.owner));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a queued or processing download', description: 'Cancelled job records remain until expiry. Repeated cancellation is idempotent.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DownloadDto })
  @ApiNotFoundResponse({ type: ErrorDto })
  @ApiConflictResponse({ type: ErrorDto, description: 'Job is already completed or failed.' })
  async cancel(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return publicJob(await this.downloads.cancel(id, req.owner));
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Download a completed file', description: 'Requires the same consumer identity as job creation. Files expire after one hour by default.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('video/mp4', 'audio/mpeg')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ErrorDto })
  @ApiConflictResponse({ type: ErrorDto })
  async file(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    const job = this.downloads.get(id, req.owner);
    if (job.status !== 'completed') throw new ConflictException('Download is not ready.');
    const file = path.join(this.downloads.directory(id), `media.${job.input.format}`);
    const info = await stat(file);
    return new StreamableFile(createReadStream(file), {
      type: job.input.format === 'mp3' ? 'audio/mpeg' : 'video/mp4',
      length: info.size, disposition: `attachment; filename="${job.id}.${job.input.format}"`,
    });
  }
}
