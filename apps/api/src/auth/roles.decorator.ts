import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const allowedRolesKey = 'allowedRoles';

export const Roles = (...roles: UserRole[]) => SetMetadata(allowedRolesKey, roles);
