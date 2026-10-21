import { Body, Controller, HttpCode, Post, Req, UnsupportedMediaTypeException, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { normalizeExtract } from '../media/platforms';
import { MediaService } from '../media/media.service';
import { ErrorDto, ExtractedMediaDto, ExtractMediaDto } from './download.dto';

@ApiTags('Extraction')
@ApiBearerAuth('direct-key')
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Missing or invalid credentials.' })
@UseGuards(AuthGuard)
@Controller('v1/extract')
export class ExtractController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @ApiOperation({
    summary: 'Instant direct download links & metadata extraction',
    description: 'Extracts direct CDN streaming URLs and available qualities without saving files to the server. Fast response (1–2s). Ideal for client-side direct downloads.',
  })
  @ApiHeader({ name: 'Content-Type', required: true, schema: { type: 'string', default: 'application/json' } })
  @ApiOkResponse({ type: ExtractedMediaDto })
  @ApiBadRequestResponse({ type: ErrorDto })
  @ApiResponse({ status: 413, type: ErrorDto, description: 'Body exceeds 4 KiB.' })
  @ApiResponse({ status: 415, type: ErrorDto, description: 'Content-Type must be application/json.' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'Submission limit reached.' })
  @ApiResponse({ status: 503, type: ErrorDto, description: 'Media executables are missing or unavailable on the server.' })
  async extract(@Body() dto: ExtractMediaDto, @Req() req: AuthenticatedRequest) {
    if (!req.is('application/json')) throw new UnsupportedMediaTypeException('Use application/json.');
    const { url, platform } = normalizeExtract(dto.url);
    await this.media.ensureTools();
    return this.media.extract(url, platform);
  }
}
