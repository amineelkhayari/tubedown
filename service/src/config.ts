import { Global, Inject, Injectable, Module } from '@nestjs/common';
import path from 'node:path';
import type { ExtractRunner, MediaRunner } from './media/media.types';

export interface ServiceOptions {
  directory?: string;
  apiKey?: string;
  rapidSecret?: string;
  runner?: MediaRunner;
  extractRunner?: ExtractRunner;
  concurrency?: number;
  ttl?: number;
  timeout?: number;
  maxDuration?: number;
  maxFilesize?: string;
}
export const OPTIONS = Symbol('SERVICE_OPTIONS');

@Injectable()
export class ServiceConfig {
  readonly directory: string;
  readonly apiKey?: string;
  readonly rapidSecret?: string;
  readonly concurrency: number;
  readonly ttl: number;
  readonly timeout: number;
  readonly maxDuration: number;
  readonly maxFilesize: string;
  readonly runner?: MediaRunner;
  readonly extractRunner?: ExtractRunner;
  readonly publicDirectory = path.resolve(__dirname, '../public');
  constructor(@Inject(OPTIONS) options: ServiceOptions) {
    this.directory = path.resolve(options.directory ?? process.env.DATA_DIR ?? path.join(__dirname, '../data'));
    this.apiKey = options.apiKey ?? process.env.API_KEY;
    this.rapidSecret = options.rapidSecret ?? process.env.RAPIDAPI_PROXY_SECRET;
    if (!this.apiKey && !this.rapidSecret) throw new Error('Set API_KEY or RAPIDAPI_PROXY_SECRET.');
    if ([this.apiKey, this.rapidSecret].some(key => key && key.length < 32)) throw new Error('Secrets must contain at least 32 characters.');
    this.concurrency = options.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 2);
    this.ttl = options.ttl ?? Number(process.env.FILE_TTL_MS ?? 3600000);
    this.timeout = options.timeout ?? Number(process.env.JOB_TIMEOUT_MS ?? 900000);
    this.maxDuration = options.maxDuration ?? Number(process.env.MAX_DURATION_SECONDS ?? 600);
    this.maxFilesize = options.maxFilesize ?? (process.env.MAX_FILESIZE ?? '200M');
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 8) throw new Error('WORKER_CONCURRENCY must be 1–8.');
    if (![this.ttl, this.timeout].every(value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647)) throw new Error('Timeouts must be positive integers below 2147483648.');
    this.runner = options.runner;
    this.extractRunner = options.extractRunner;
  }
}


@Global()
@Module({})
export class ConfigurationModule {
  static register(options: ServiceOptions) {
    return { module: ConfigurationModule, providers: [{ provide: OPTIONS, useValue: options }, ServiceConfig], exports: [ServiceConfig] };
  }
}
