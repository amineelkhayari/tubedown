import { existsSync } from 'node:fs';
import path from 'node:path';
import { createApplication } from './bootstrap';

// Automatically load .env if not already set (supports root, service folder, and dev mode)
if (!process.env.API_KEY && !process.env.RAPIDAPI_PROXY_SECRET) {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'service/.env'),
    path.resolve(__dirname, '../.env'),
  ];
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      try {
        if (typeof (process as any).loadEnvFile === 'function') {
          (process as any).loadEnvFile(envPath);
        }
        if (process.env.API_KEY || process.env.RAPIDAPI_PROXY_SECRET) break;
      } catch {}
    }
  }
}

async function bootstrap() {
  const { app } = await createApplication();
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  await app.listen(port, host);
  console.log(`Web: http://localhost:${port} | Swagger: http://localhost:${port}/docs`);
}
bootstrap().catch(error => { console.error(error.message); process.exitCode = 1; });
