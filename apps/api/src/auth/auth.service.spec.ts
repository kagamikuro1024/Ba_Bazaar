import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

function createService() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    auditLog: {
      create: vi.fn().mockResolvedValue(undefined)
    }
  };
  const jwtService = {
    signAsync: vi.fn().mockResolvedValue('signed-access-token'),
    verifyAsync: vi.fn()
  };
  const configService = {
    get: vi.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_SECRET: 'test-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL_DAYS: '14',
        ALLOW_MOCK_AUTH: 'false'
      };
      return values[key];
    })
  };

  return {
    prisma,
    jwtService,
    configService,
    service: new AuthService(
      prisma as never,
      jwtService as never,
      configService as never
    )
  };
}

function requestWithHeaders(headers: Record<string, string> = {}) {
  return {
    headers,
    ip: '127.0.0.1'
  } as Request;
}

describe('AuthService', () => {
  it('registers PM_PO users by default', async () => {
    const { prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'user-1',
      full_name: data.full_name,
      email: data.email,
      role: data.role,
      password_hash: data.password_hash,
      avatar_url: null,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    }));

    const result = await service.register({
      full_name: 'Test PM',
      email: 'pm@test.local',
      password: 'Password@123'
    });

    expect(prisma.user.create).toHaveBeenCalled();
    expect(result.user.role).toBe(UserRole.PM_PO);
  });

  it('rejects duplicate register emails', async () => {
    const { prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'existing'
    });

    await expect(
      service.register({
        full_name: 'Test PM',
        email: 'pm@test.local',
        password: 'Password@123'
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in with valid credentials and returns tokens', async () => {
    const { prisma, service } = createService();
    const password_hash = await hashPassword('Password@123');
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      full_name: 'Test PM',
      email: 'pm@test.local',
      role: UserRole.PM_PO,
      password_hash,
      avatar_url: null,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      full_name: 'Test PM',
      email: 'pm@test.local',
      role: UserRole.PM_PO,
      password_hash,
      avatar_url: null,
      last_login_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    });
    prisma.refreshToken.create.mockResolvedValue(undefined);

    const result = await service.login(
      {
        email: 'pm@test.local',
        password: 'Password@123'
      },
      requestWithHeaders({ 'user-agent': 'vitest' })
    );

    expect(result.access_token).toBe('signed-access-token');
    expect(result.refresh_token).toBeTruthy();
    expect(result.user.role).toBe(UserRole.PM_PO);
  });

  it('rejects login with invalid password', async () => {
    const { prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      full_name: 'Test PM',
      email: 'pm@test.local',
      role: UserRole.PM_PO,
      password_hash: await hashPassword('Password@123'),
      avatar_url: null,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    });

    await expect(
      service.login(
        {
          email: 'pm@test.local',
          password: 'WrongPassword'
        },
        requestWithHeaders()
      )
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refreshes a valid refresh token and revokes the old one', async () => {
    const { prisma, service } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-1',
      token_hash: 'hashed',
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      user: {
        id: 'user-1',
        full_name: 'Manager',
        email: 'manager@test.local',
        role: UserRole.BA_MANAGER,
        password_hash: 'hash',
        avatar_url: null,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    prisma.refreshToken.update.mockResolvedValue(undefined);
    prisma.refreshToken.create.mockResolvedValue(undefined);

    const result = await service.refresh(
      {
        refresh_token: 'refresh-token'
      },
      requestWithHeaders()
    );

    expect(prisma.refreshToken.update).toHaveBeenCalled();
    expect(result.access_token).toBe('signed-access-token');
  });

  it('revokes refresh token on logout', async () => {
    const { prisma, service } = createService();
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.logout({
      refresh_token: 'refresh-token'
    });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});
