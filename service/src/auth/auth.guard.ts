import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ServiceConfig } from '../config';

export interface AuthenticatedRequest extends Request { owner: string; }
const digest = (value: string) => createHash('sha256').update(value).digest();
const matches = (a: unknown, b: string | undefined) => typeof a === 'string' && Boolean(a && b) && timingSafeEqual(digest(a), digest(b!));

export function authenticate(headers: Request['headers'], config: Pick<ServiceConfig, 'apiKey' | 'rapidSecret'>): string {
  if (matches(headers['x-rapidapi-proxy-secret'], config.rapidSecret)) {
    const user = headers['x-rapidapi-user'];
    if (typeof user !== 'string' || !user || user.length > 200) throw new UnauthorizedException('Missing RapidAPI consumer identity.');
    return `rapid:${user}`;
  }
  if (matches(headers.authorization, config.apiKey ? `Bearer ${config.apiKey}` : undefined)) return `direct:${digest(config.apiKey!).toString('hex')}`;
  throw new UnauthorizedException('Valid API authentication is required.');
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ServiceConfig) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    req.owner = authenticate(req.headers, this.config);
    return true;
  }
}
