import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { RateLimitGuard } from './rate-limit.guard';
@Module({ providers: [AuthGuard, RateLimitGuard], exports: [AuthGuard, RateLimitGuard] })
export class AuthModule {}
