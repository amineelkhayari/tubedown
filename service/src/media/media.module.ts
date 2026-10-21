import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { PlatformsController } from './media.controller';
@Module({ controllers: [PlatformsController], providers: [MediaService], exports: [MediaService] })
export class MediaModule {}
