import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCurrentUser(request: Request): Promise<User> {
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

  private readHeader(request: Request, headerName: string) {
    const value = request.headers[headerName];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value;
  }

  private normalizeRole(value?: string): UserRole | undefined {
    if (!value) {
      return undefined;
    }

    if (value === 'BUSINESS_ANALYST') {
      return UserRole.BA;
    }

    return Object.values(UserRole).includes(value as UserRole) ? (value as UserRole) : undefined;
  }
}
