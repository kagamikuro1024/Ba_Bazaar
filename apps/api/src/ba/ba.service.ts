import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { BAStatus, BALevel, SkillTagStatus, User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { monthRange, toDateKey, workingDaysInRange } from '../domain/date';
import { calculateBookedWorkingDays } from '../domain/capacity';
import { optionalString, requireDate, requireString } from '../common/parse';
import { isManagerRole } from '../auth/rbac';

type DirectoryQuery = {
  search?: string;
  status?: BAStatus;
  level?: BALevel;
  tags?: string;
  bookable?: string;
};

type CreateBAInput = {
  full_name?: string;
  email?: string;
  phone?: string;
  level?: BALevel;
  joined_date?: string;
  avatar_url?: string;
  status?: BAStatus;
};

@Injectable()
export class BAService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: User, query: DirectoryQuery) {
    const tagFilters = (query.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      );

    const where = {
      ...(currentUser.role === UserRole.PM_PO || query.bookable === 'true'
        ? { status: BAStatus.ACTIVE }
        : {}),
      ...(currentUser.role === UserRole.BA ? { user_id: currentUser.id } : {}),
      ...(query.status && isManagerRole(currentUser.role) ? { status: query.status } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.search
        ? {
            OR: [
              { full_name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } }
            ]
          }
        : {}),
      ...(tagFilters.length
        ? {
            AND: tagFilters.map((tag) => ({
              skill_tags: {
                some: {
                  tag: isUuid(tag) ? { id: tag } : { name: tag }
                }
              }
            }))
          }
        : {})
    };

    return this.prisma.bAProfile.findMany({
      where,
      orderBy: [{ status: 'asc' }, { full_name: 'asc' }],
      include: {
        skill_tags: { include: { tag: true } },
        bookings: {
          where: {
            status: { in: ['APPROVED', 'IN_PROGRESS', 'PENDING'] },
            end_date: { gte: new Date('2026-06-01T00:00:00.000Z') },
            start_date: { lte: new Date('2026-06-30T00:00:00.000Z') }
          }
        }
      }
    });
  }

  async create(currentUser: User, input: CreateBAInput) {
    this.ensureManager(currentUser);

    const email = requireString(input.email, 'email').toLowerCase();
    const existing = await this.prisma.bAProfile.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('BA email already exists');
    }

    const created = await this.prisma.bAProfile.create({
      data: {
        full_name: requireString(input.full_name, 'full_name'),
        email,
        phone: optionalString(input.phone),
        level: input.level ?? BALevel.MIDDLE,
        joined_date: input.joined_date ? requireDate(input.joined_date, 'joined_date') : new Date(),
        avatar_url: optionalString(input.avatar_url),
        status: input.status ?? BAStatus.ACTIVE
      },
      include: { skill_tags: { include: { tag: true } } }
    });

    await this.audit(currentUser, 'CREATE_BA_PROFILE', 'BAProfile', created.id, null, {
      id: created.id,
      email: created.email
    });

    return created;
  }

  async getById(currentUser: User, id: string) {
    const ba = await this.prisma.bAProfile.findUnique({
      where: { id },
      include: {
        skill_tags: { include: { tag: true } },
        bookings: {
          include: { project: true, requester: true, manager: true },
          orderBy: { start_date: 'desc' }
        }
      }
    });

    if (!ba) {
      throw new NotFoundException('BA profile not found');
    }

    if (currentUser.role === UserRole.PM_PO && ba.status !== BAStatus.ACTIVE) {
      throw new ForbiddenException('PM/PO can only view active BA public profiles');
    }

    if (currentUser.role === UserRole.BA && ba.user_id !== currentUser.id) {
      throw new ForbiddenException('BA can only view own profile');
    }

    return ba;
  }

  async update(currentUser: User, id: string, input: Partial<CreateBAInput>) {
    this.ensureManager(currentUser);
    const existing = await this.getExisting(id);

    if (existing.status === BAStatus.RESIGNED) {
      throw new BadRequestException('Resigned BA profile is read-only in Manager UI');
    }

    if (input.email && input.email.toLowerCase() !== existing.email.toLowerCase()) {
      throw new BadRequestException('BA email is immutable');
    }

    const updated = await this.prisma.bAProfile.update({
      where: { id },
      data: {
        full_name: input.full_name,
        phone: input.phone,
        level: input.level,
        joined_date: input.joined_date ? requireDate(input.joined_date, 'joined_date') : undefined,
        avatar_url: input.avatar_url,
        version: { increment: 1 }
      },
      include: { skill_tags: { include: { tag: true } } }
    });

    await this.audit(currentUser, 'UPDATE_BA_PROFILE', 'BAProfile', id, existing, updated);
    return updated;
  }

  async changeStatus(
    currentUser: User,
    id: string,
    input: { status?: BAStatus; status_reason?: string }
  ) {
    this.ensureManager(currentUser);
    const existing = await this.getExisting(id);

    if (existing.status === BAStatus.RESIGNED && input.status !== BAStatus.RESIGNED) {
      throw new BadRequestException('Manager UI cannot restore a resigned BA');
    }

    const status = input.status ?? BAStatus.ACTIVE;
    const updated = await this.prisma.bAProfile.update({
      where: { id },
      data: {
        status,
        status_reason: optionalString(input.status_reason),
        status_changed_at: new Date(),
        version: { increment: 1 }
      },
      include: { skill_tags: { include: { tag: true } } }
    });

    await this.audit(currentUser, 'CHANGE_BA_STATUS', 'BAProfile', id, existing, updated);
    return updated;
  }

  async publicCard(currentUser: User, id: string) {
    const ba = await this.getById(currentUser, id);

    return {
      id: ba.id,
      full_name: ba.full_name,
      level: ba.level,
      avatar_url: ba.avatar_url,
      status: ba.status,
      skill_tags: ba.skill_tags.map((item) => item.tag)
    };
  }

  async bookingHistory(currentUser: User, id: string) {
    await this.getById(currentUser, id);

    return this.prisma.booking.findMany({
      where: { ba_id: id },
      include: { project: true, requester: true, manager: true },
      orderBy: { start_date: 'desc' }
    });
  }

  async utilization(currentUser: User, id: string, month = '2026-06') {
    await this.getById(currentUser, id);

    const { startDate, endDate } = monthRange(month);
    const bookings = await this.prisma.booking.findMany({
      where: {
        ba_id: id,
        start_date: { lte: endDate },
        end_date: { gte: startDate }
      }
    });
    const workingDays = workingDaysInRange(startDate, endDate).length;
    const bookedDays = calculateBookedWorkingDays(bookings, startDate, endDate);

    return {
      ba_id: id,
      period: month,
      start_date: toDateKey(startDate),
      end_date: toDateKey(endDate),
      working_days: workingDays,
      booked_days: Number(bookedDays.toFixed(2)),
      utilization_percent: workingDays
        ? Number(((bookedDays / workingDays) * 100).toFixed(1))
        : 0
    };
  }

  async listTags() {
    return this.prisma.skillTag.findMany({
      where: { status: SkillTagStatus.ACTIVE },
      orderBy: [{ group: 'asc' }, { name: 'asc' }]
    });
  }

  async addTag(currentUser: User, baId: string, tagId: string) {
    this.ensureManager(currentUser);
    await this.getExisting(baId);

    const mapping = await this.prisma.bASkillTag.upsert({
      where: { ba_id_tag_id: { ba_id: baId, tag_id: tagId } },
      update: {},
      create: {
        ba_id: baId,
        tag_id: tagId,
        assigned_by: currentUser.id
      },
      include: { tag: true }
    });

    await this.audit(currentUser, 'ADD_BA_TAG', 'BAProfile', baId, null, {
      tag_id: tagId
    });
    return mapping;
  }

  async removeTag(currentUser: User, baId: string, tagId: string) {
    this.ensureManager(currentUser);
    await this.prisma.bASkillTag.delete({
      where: { ba_id_tag_id: { ba_id: baId, tag_id: tagId } }
    });
    await this.audit(currentUser, 'REMOVE_BA_TAG', 'BAProfile', baId, { tag_id: tagId }, null);
    return { status: 'ok' };
  }

  async listNotes(currentUser: User, baId: string) {
    this.ensureManager(currentUser);
    return this.prisma.privateNote.findMany({
      where: { ba_id: baId },
      include: { creator: true },
      orderBy: { created_at: 'desc' }
    });
  }

  async appendNote(currentUser: User, baId: string, input: { content?: string }) {
    this.ensureManager(currentUser);
    const content = requireString(input.content, 'content');
    if (content.length > 5000) {
      throw new BadRequestException('content must be 5000 characters or less');
    }

    const note = await this.prisma.privateNote.create({
      data: {
        ba_id: baId,
        content,
        created_by: currentUser.id
      },
      include: { creator: true }
    });

    await this.audit(currentUser, 'APPEND_PRIVATE_NOTE', 'BAProfile', baId, null, {
      note_id: note.id
    });
    return note;
  }

  private ensureManager(user: User) {
    if (!isManagerRole(user.role)) {
      throw new ForbiddenException('Manager or Admin role required');
    }
  }

  private async getExisting(id: string) {
    const ba = await this.prisma.bAProfile.findUnique({ where: { id } });
    if (!ba) {
      throw new NotFoundException('BA profile not found');
    }
    return ba;
  }

  private async audit(
    user: User,
    action: string,
    targetType: string,
    targetId: string,
    oldValue: unknown,
    newValue: unknown
  ) {
    await this.prisma.auditLog.create({
      data: {
        actor_id: user.id,
        action,
        target_type: targetType,
        target_id: targetId,
        old_value: oldValue === null ? undefined : JSON.parse(JSON.stringify(oldValue)),
        new_value: newValue === null ? undefined : JSON.parse(JSON.stringify(newValue)),
        result: 'SUCCESS'
      }
    });
  }
}
