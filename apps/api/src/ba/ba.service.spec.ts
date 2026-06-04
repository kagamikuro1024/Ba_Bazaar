import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BALevel, BAStatus, UserRole, type User } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BAService } from './ba.service';

function createService() {
  const prisma = {
    bAProfile: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    auditLog: {
      create: vi.fn().mockResolvedValue(undefined)
    },
    $transaction: vi.fn()
  };

  const service = new BAService(prisma as never);
  return { prisma, service };
}

function managerUser(): User {
  return {
    id: 'manager-1',
    full_name: 'Manager',
    email: 'manager@ba-bazaar.local',
    role: UserRole.BA_MANAGER,
    password_hash: 'hash',
    avatar_url: null,
    last_login_at: null,
    created_at: new Date(),
    updated_at: new Date()
  };
}

describe('BAService.create', () => {
  it('creates a BA login account and linked BA profile', async () => {
    const { prisma, service } = createService();

    prisma.bAProfile.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma)
    );
    prisma.user.create.mockResolvedValue({
      id: 'user-1'
    });
    prisma.bAProfile.create.mockResolvedValue({
      id: 'ba-1',
      user_id: 'user-1',
      full_name: 'New BA',
      email: 'ba.new@ba-bazaar.local',
      phone: '0900000000',
      level: BALevel.MIDDLE,
      joined_date: new Date('2026-06-04T00:00:00.000Z'),
      avatar_url: null,
      status: BAStatus.ACTIVE,
      skill_tags: []
    });

    const result = await service.create(managerUser(), {
      full_name: 'New BA',
      email: 'ba.new@ba-bazaar.local',
      password: 'Password@123',
      phone: '0900000000',
      level: BALevel.MIDDLE,
      joined_date: '2026-06-04'
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          full_name: 'New BA',
          email: 'ba.new@ba-bazaar.local',
          role: UserRole.BA
        })
      })
    );
    expect(prisma.bAProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user-1',
          email: 'ba.new@ba-bazaar.local'
        })
      })
    );
    expect(result.user_id).toBe('user-1');
  });

  it('rejects short initial password', async () => {
    const { service } = createService();

    await expect(
      service.create(managerUser(), {
        full_name: 'New BA',
        email: 'ba.new@ba-bazaar.local',
        password: 'short'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-manager create attempt', async () => {
    const { service } = createService();

    await expect(
      service.create(
        {
          ...managerUser(),
          role: UserRole.PM_PO
        },
        {
          full_name: 'New BA',
          email: 'ba.new@ba-bazaar.local',
          password: 'Password@123'
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
