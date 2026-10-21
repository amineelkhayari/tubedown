import { CanActivate, ExecutionContext, HttpException, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.guard';

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly entries = new Map<string, { count: number; until: number }>();
  private readonly timer = setInterval(() => {
    for (const [owner, entry] of this.entries) if (entry.until <= Date.now()) this.entries.delete(owner);
  }, 60000).unref();
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let entry = this.entries.get(req.owner);
    if (!entry || entry.until <= Date.now()) {
      entry = { count: 0, until: Date.now() + 60000 }; this.entries.set(req.owner, entry);
    }
    if (++entry.count > 5) {
      context.switchToHttp().getResponse<Response>().setHeader('Retry-After', Math.ceil((entry.until - Date.now()) / 1000));
      throw new HttpException('Maximum five submissions per minute.', 429);
    }
    return true;
  }
  onModuleDestroy() { clearInterval(this.timer); }
}
