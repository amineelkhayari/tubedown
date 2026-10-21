import { ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ServiceConfig } from '../config';
import { MediaService } from '../media/media.service';
import type { MediaInput, MediaOutput } from '../media/media.types';
import { MediaProcessingError } from '../media/media-error';
import type { DownloadDto } from './download.dto';

export interface JobRecord {
  id: string; owner: string; input: MediaInput;
  status: 'creating' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: number; expiresAt: number; output?: MediaOutput; error?: string;
}
const active = (job: JobRecord) => ['creating', 'queued', 'processing'].includes(job.status);

export function publicJob(job: JobRecord): DownloadDto {
  return {
    id: job.id, status: job.status, format: job.input.format, platform: job.input.platform ?? 'youtube',
    createdAt: new Date(job.createdAt).toISOString(), expiresAt: active(job) ? null : new Date(job.expiresAt).toISOString(),
    ...(job.error ? { error: job.error } : {}),
    ...(job.status === 'completed' && job.output ? { size: job.output.size, downloadPath: `/v1/jobs/${job.id}/file` } : {}),
  };
}

@Injectable()
export class DownloadsService implements OnModuleInit, OnModuleDestroy {
  readonly items = new Map<string, JobRecord>();
  readonly running = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly logger = new Logger(DownloadsService.name);
  private timer?: NodeJS.Timeout;
  private closed = false;
  private cleaning = false;
  constructor(readonly config: ServiceConfig, private readonly media: MediaService) {}

  async onModuleInit() {
    await mkdir(this.config.directory, { recursive: true });
    for (const entry of await readdir(this.config.directory)) {
      if (!/^[a-f0-9-]{36}$/.test(entry)) continue;
      let job: JobRecord;
      try { job = JSON.parse(await readFile(path.join(this.config.directory, entry, 'job.json'), 'utf8')); }
      catch { this.logger.warn(`Skipping unreadable job ${entry}`); continue; }
      if (job.id !== entry || typeof job.owner !== 'string' || !job.input || !['mp3', 'mp4'].includes(job.input.format) || !Number.isFinite(job.expiresAt) || !Number.isFinite(job.createdAt)) continue;
      if (active(job)) { job.status = 'failed'; job.error = 'Service restarted. Submit the download again.'; job.expiresAt = Date.now() + this.config.ttl; await this.save(job); }
      this.items.set(job.id, job);
    }
    await this.cleanup();
    this.timer = setInterval(() => this.cleanup().catch(error => this.logger.error(error)), 60000).unref();
  }

  // Serialize writes per job to prevent cancellation/completion overwriting a newer state.
  save(job: JobRecord): Promise<void> {
    const content = JSON.stringify(job);
    const operation = (this.writes.get(job.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const directory = this.directory(job.id);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'job.tmp'), content);
      await rename(path.join(directory, 'job.tmp'), path.join(directory, 'job.json'));
    });
    this.writes.set(job.id, operation);
    return operation.finally(() => { if (this.writes.get(job.id) === operation) this.writes.delete(job.id); });
  }
  directory(id: string) { return path.join(this.config.directory, id); }
  async create(owner: string, input: MediaInput) {
    if (this.closed) throw new ServiceUnavailableException('Service is shutting down.');
    const pending = [...this.items.values()].filter(active);
    if (pending.length >= 20 || pending.filter(job => job.owner === owner).length >= 3) throw new HttpException('Queue limit reached. Retry after an existing job completes.', 429);
    const job: JobRecord = { id: randomUUID(), owner, input, status: 'creating', createdAt: Date.now(), expiresAt: Date.now() + this.config.ttl };
    this.items.set(job.id, job);
    try { await this.save({ ...job, status: 'queued' }); } catch (error) { this.items.delete(job.id); throw error; }
    job.status = 'queued'; this.pump(); return job;
  }
  get(id: string, owner: string) {
    const job = this.items.get(id);
    if (!job || job.owner !== owner || (!active(job) && job.expiresAt <= Date.now())) throw new NotFoundException('Job not found or expired.');
    return job;
  }
  list(owner: string) {
    return [...this.items.values()].filter(job => job.owner === owner && (active(job) || job.expiresAt > Date.now())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(publicJob);
  }
  async cancel(id: string, owner: string) {
    const job = this.get(id, owner);
    if (job.status === 'cancelled') return job;
    if (!active(job)) throw new ConflictException('Only queued or processing jobs can be cancelled.');
    job.status = 'cancelled'; job.expiresAt = Date.now() + this.config.ttl;
    this.running.get(id)?.abort();
    await this.save(job);
    await this.tasks.get(id);
    return job;
  }
  private pump() {
    if (this.closed) return;
    for (const job of this.items.values()) {
      if (this.running.size >= this.config.concurrency) break;
      if (job.status !== 'queued') continue;
      const controller = new AbortController(); job.status = 'processing'; this.running.set(job.id, controller);
      const task = this.execute(job, controller).catch(error => this.logger.error(error)).finally(() => this.tasks.delete(job.id));
      this.tasks.set(job.id, task);
    }
  }
  private async execute(job: JobRecord, controller: AbortController) {
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);
    try {
      await this.save(job);
      const output = await this.media.run(job.input, this.directory(job.id), controller.signal);
      if (controller.signal.aborted) throw new Error('Stopped');
      job.output = output; job.status = 'completed';
    } catch (error) {
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = error instanceof MediaProcessingError ? error.message : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Media processing tools are not installed on the server.' : 'Download failed, was interrupted, or exceeded a limit. The provider may require login or block this server.';
      }
    } finally {
      clearTimeout(timeout); job.expiresAt = Date.now() + this.config.ttl;
      try { await this.save(job); } finally { this.running.delete(job.id); this.pump(); }
    }
  }
  async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      for (const job of this.items.values()) {
        if (active(job) || this.running.has(job.id) || job.expiresAt > Date.now()) continue;
        await this.writes.get(job.id);
        await rm(this.directory(job.id), { recursive: true, force: true });
        this.items.delete(job.id);
      }
    } finally { this.cleaning = false; }
  }
  async onModuleDestroy() {
    this.closed = true; clearInterval(this.timer);
    for (const controller of this.running.values()) controller.abort();
    await Promise.allSettled([...this.tasks.values(), ...this.writes.values()]);
  }
}
