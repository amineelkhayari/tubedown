import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { platforms } from './platforms';

export class PlatformDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String] }) hosts!: string[];
  @ApiProperty() example!: string;
  @ApiProperty() notes!: string;
  @ApiProperty({ type: [String], enum: ['mp4', 'mp3'], isArray: true }) formats!: string[];
  @ApiProperty({ enum: ['enabled'] }) status!: string;
  @ApiProperty({ description: 'False until verified with real media from the deployed host.' }) liveVerified!: boolean;
}

@ApiTags('Platforms')
@Controller('v1/platforms')
export class PlatformsController {
  @Get()
  @ApiOperation({ summary: 'List enabled media platforms and supported URL types', description: 'Enabled means accepted by this API and routed to yt-dlp. It is not a guarantee that every public video can be downloaded.' })
  @ApiOkResponse({ type: PlatformDto, isArray: true })
  list() { return platforms(); }
}
