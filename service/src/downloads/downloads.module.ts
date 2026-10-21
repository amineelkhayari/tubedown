import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { DownloadsController } from './downloads.controller';
import { ExtractController } from './extract.controller';
import { DownloadsService } from './downloads.service';
@Module({ imports: [AuthModule, MediaModule], controllers: [DownloadsController, ExtractController], providers: [DownloadsService], exports: [DownloadsService] })
export class DownloadsModule {}

