import { Module } from '@nestjs/common';
import { DownloadsModule } from '../downloads/downloads.module';
import { MediaModule } from '../media/media.module';
import { FallbackController } from './fallback.controller';

@Module({
  imports: [DownloadsModule, MediaModule],
  controllers: [FallbackController],
})
export class FallbackModule {}
