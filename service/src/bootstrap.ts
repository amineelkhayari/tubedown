import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ServiceConfig, type ServiceOptions } from './config';
import { HttpErrorFilter } from './common/http-error.filter';

export async function createApplication(options: ServiceOptions = {}, logging = true) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), { bodyParser: false, logger: logging ? ['log', 'error', 'warn'] : false, abortOnError: false });
  const config = app.get(ServiceConfig);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      mediaSrc: ["'self'", 'https:', 'blob:', 'data:'],
      connectSrc: ["'self'", 'https:', 'blob:'],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    } },
    strictTransportSecurity: process.env.NODE_ENV === 'production' ? undefined : false,
  }));
  app.use((_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.useBodyParser('json', { limit: '4kb', strict: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
  app.useGlobalFilters(new HttpErrorFilter());
  app.useStaticAssets(config.publicDirectory, { index: 'index.html', dotfiles: 'deny' });

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('YTDownloader Media API')
    .setDescription('Direct media link extraction and asynchronous transcode downloads with NestJS. Supports instant direct CDN link extraction (/v1/extract) and server-side transcode jobs (/v1/jobs) with quality options from 144p to 4K and MP3 audio up to 320 kbps. Use Authorize with your direct API key for local testing. RapidAPI customers use their gateway key and host; the proxy secret is server-only.')
    .setVersion('1.1.0')
    .addServer(process.env.PUBLIC_API_URL || '/')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Direct service key (API_KEY). Never share the operator key with RapidAPI consumers.' }, 'direct-key')
    .build());
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: '/openapi.json', yamlDocumentUrl: '/openapi.yaml',
    customSiteTitle: 'YTDownloader API · Swagger',
    swaggerOptions: { persistAuthorization: false, validatorUrl: null, docExpansion: 'list' },
  });
  await app.init();
  return { app, document };
}
