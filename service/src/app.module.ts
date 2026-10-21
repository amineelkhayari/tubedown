import { Module } from '@nestjs/common';
import { ConfigurationModule, type ServiceOptions } from './config';
import { DownloadsModule } from './downloads/downloads.module';
import { MediaModule } from './media/media.module';
import { HealthController, ReadinessService } from './health/health.controller';
@Module({})
export class AppModule {
  static register(options: ServiceOptions = {}) {
    return { module: AppModule, imports: [ConfigurationModule.register(options), DownloadsModule, MediaModule], controllers: [HealthController], providers: [ReadinessService] };
  }
}
