import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { canManageBaProfile } from '../auth/rbac';
import { optionalString, requireString } from '../common/parse';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.project.findMany({ orderBy: { name: 'asc' } });
  }

  async create(currentUser: User, input: Record<string, unknown>) {
    if (!canManageBaProfile(currentUser.role)) {
      throw new ForbiddenException('BA Manager role required to create project');
    }

    const project = await this.prisma.project.create({
      data: {
        name: requireString(input.name, 'name'),
        color: optionalString(input.color) ?? '#2563EB',
        description: optionalString(input.description)
      }
    });

    await this.prisma.auditLog.create({
      data: {
        actor_id: currentUser.id,
        action: 'CREATE_PROJECT',
        target_type: 'Project',
        target_id: project.id,
        new_value: project,
        result: 'SUCCESS'
      }
    });

    return project;
  }
}
