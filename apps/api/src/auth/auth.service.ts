import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, AuthenticatedUserView } from './auth.types';
import { hashPassword, verifyPassword } from './password';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {}

  async getCurrentUser(request: Request): Promise<User> {
    const accessToken = this.readBearerToken(request);

    if (accessToken) {
      const payload = await this.verifyAccessToken(accessToken);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub }
      });

      if (!user) {
        throw new UnauthorizedException('Authenticated user no longer exists.');
      }

      return user;
    }

    if (!this.allowMockAuth()) {
      throw new UnauthorizedException('Authentication required.');
    }

    const userId = this.readHeader(request, 'x-user-id');
    const requestedRole = this.readHeader(request, 'x-mock-role');
    const role = this.normalizeRole(requestedRole);

    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : await this.prisma.user.findFirst({
          where: role ? { role } : { role: UserRole.BA_MANAGER },
          orderBy: { created_at: 'asc' }
        });

    if (!user) {
      throw new UnauthorizedException('Mock user is not available. Run seed data first.');
    }

    return user;
  }

  async assertRole(user: User, roles: UserRole[], action: string) {
    if (roles.includes(user.role)) {
      return;
    }

    await this.prisma.auditLog
      .create({
        data: {
          actor_id: user.id,
          action,
          target_type: 'Permission',
          target_id: user.id,
          result: 'DENIED'
        }
      })
      .catch(() => undefined);

    throw new ForbiddenException('You do not have permission for this action.');
  }

  async register(input: Record<string, unknown>) {
    const fullName = this.readRequiredString(input.full_name, 'full_name');
    const email = this.readEmail(input.email);
    const password = this.readPassword(input.password);

    const existing = await this.prisma.user.findUnique({
      where: { email }
    });

    if (existing) {
      throw new ConflictException('Email is already registered.');
    }

    const user = await this.prisma.user.create({
      data: {
        full_name: fullName,
        email,
        role: UserRole.PM_PO,
        password_hash: await hashPassword(password)
      }
    });

    return { user: this.toUserView(user) };
  }

  async login(input: Record<string, unknown>, request: Request) {
    const email = this.readEmail(input.email);
    const password = this.readRequiredString(input.password, 'password');
    const user = await this.prisma.user.findUnique({
      where: { email }
    });

    if (!user?.password_hash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const refreshedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() }
    });

    return this.issueAuthResponse(refreshedUser, request);
  }

  async refresh(input: Record<string, unknown>, request: Request) {
    const refreshToken = this.readRequiredString(input.refresh_token, 'refresh_token');
    const tokenHash = this.hashRefreshToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
      include: { user: true }
    });

    if (!record || record.revoked_at || record.expires_at <= new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked_at: new Date() }
    });

    return this.issueAuthResponse(record.user, request);
  }

  async logout(input: Record<string, unknown>) {
    const refreshToken = this.readOptionalString(input.refresh_token);

    if (refreshToken) {
      const tokenHash = this.hashRefreshToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: {
          token_hash: tokenHash,
          revoked_at: null
        },
        data: { revoked_at: new Date() }
      });
    }

    return { success: true };
  }

  toUserView(user: User): AuthenticatedUserView {
    return {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      avatar_url: user.avatar_url ?? null
    };
  }

  private readHeader(request: Request, headerName: string) {
    const value = request.headers[headerName];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value;
  }

  private readBearerToken(request: Request) {
    const authorization = this.readHeader(request, 'authorization');
    if (!authorization) {
      return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Authorization header must be Bearer token.');
    }

    return token;
  }

  private async verifyAccessToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.getJwtSecret()
      });
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }

  private async issueAuthResponse(user: User, request: Request) {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        role: user.role,
        email: user.email
      } satisfies AccessTokenPayload,
      {
        secret: this.getJwtSecret(),
        expiresIn: this.getAccessTokenTtl()
      }
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000
    );

    await this.prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: this.hashRefreshToken(refreshToken),
        expires_at: refreshExpiresAt,
        user_agent: this.readHeader(request, 'user-agent') ?? null,
        ip_address: this.getRequestIp(request)
      }
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: this.toUserView(user)
    };
  }

  private getJwtSecret() {
    const secret = this.configService.get<string>('JWT_SECRET')?.trim();

    if (!secret || secret === 'replace_with_a_long_random_secret') {
      throw new InternalServerErrorException('JWT_SECRET must be configured.');
    }

    return secret;
  }

  private getAccessTokenTtl() {
    return this.parseDurationToSeconds(
      this.configService.get<string>('JWT_ACCESS_TTL') ?? '8h'
    );
  }

  private getRefreshTokenTtlDays() {
    return Number(this.configService.get<string>('JWT_REFRESH_TTL_DAYS') ?? '30');
  }

  private parseDurationToSeconds(value: string) {
    const normalized = value.trim().toLowerCase();
    const directNumber = Number(normalized);
    if (Number.isFinite(directNumber) && directNumber > 0) {
      return directNumber;
    }

    const match = normalized.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new BadRequestException('JWT_ACCESS_TTL must be a positive number or duration like 15m.');
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return amount * multiplier;
  }

  private getRequestIp(request: Request) {
    const forwarded = this.readHeader(request, 'x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0]?.trim() ?? null;
    }

    return request.ip ?? null;
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private readRequiredString(value: unknown, fieldName: string) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} is required.`);
    }

    return value.trim();
  }

  private readOptionalString(value: unknown) {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readEmail(value: unknown) {
    const email = this.readRequiredString(value, 'email').toLowerCase();
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!looksLikeEmail) {
      throw new BadRequestException('email must be a valid email address.');
    }

    return email;
  }

  private readPassword(value: unknown) {
    const password = this.readRequiredString(value, 'password');
    if (password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters.');
    }

    return password;
  }

  private allowMockAuth() {
    const isProduction =
      (this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development') ===
      'production';

    if (isProduction) {
      return false;
    }

    return (this.configService.get<string>('ALLOW_MOCK_AUTH') ?? 'false').toLowerCase() === 'true';
  }

  private normalizeRole(value?: string): UserRole | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim().toUpperCase();
    const compact = normalized.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const aliases: Record<string, UserRole> = {
      BUSINESS_ANALYST: UserRole.BA,
      BA: UserRole.BA,
      PM_PO: UserRole.PM_PO,
      PMPO: UserRole.PM_PO,
      PRODUCT_OWNER: UserRole.PM_PO,
      PROJECT_MANAGER: UserRole.PM_PO,
      BA_MANAGER: UserRole.BA_MANAGER,
      BAMANAGER: UserRole.BA_MANAGER
    };

    if (aliases[compact]) {
      return aliases[compact];
    }

    return Object.values(UserRole).includes(normalized as UserRole)
      ? (normalized as UserRole)
      : undefined;
  }
}
