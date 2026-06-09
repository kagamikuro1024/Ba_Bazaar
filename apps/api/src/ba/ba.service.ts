import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { BAStatus, BALevel, SkillTagStatus, User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { monthRange, parseDateOnly, toDateKey, workingDaysInRange } from '../domain/date';
import {
  calculateBookedWorkingDays,
  calculateUtilizationPercent,
  classifyCapacity,
  getRangeCapacity
} from '../domain/capacity';
import { optionalString, requireDate, requireString } from '../common/parse';
import { canReadPrivateNotes, canViewPrivateBaFields, isManagerRole } from '../auth/rbac';
import { hashPassword } from '../auth/password';
import { syncBookingStatuses } from '../bookings/bookings.utils';

type DirectoryQuery = {
  search?: string;
  q?: string;
  status?: string;
  level?: string;
  tags?: string;
  bookable?: string;
  from?: string;
  to?: string;
};

type CreateBAInput = {
  full_name?: string;
  email?: string;
  password?: string;
  phone?: string;
  level?: BALevel;
  joined_date?: string;
  avatar_url?: string;
  status?: BAStatus;
};

const safeUserSelect = {
  id: true,
  full_name: true,
  email: true,
  role: true,
  avatar_url: true,
  created_at: true,
  updated_at: true
} as const;

@Injectable()
export class BAService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(currentUser: User, query: DirectoryQuery) {
    await syncBookingStatuses(this.prisma);
    const timeframe = this.resolveTimeframe(query.from, query.to);
    const workingDays = workingDaysInRange(timeframe.startDate, timeframe.endDate).length;
    const search = (query.search ?? query.q)?.trim();
    const statusFilter = Object.values(BAStatus).includes(query.status as BAStatus)
      ? (query.status as BAStatus)
      : undefined;
    const levelFilter = Object.values(BALevel).includes(query.level as BALevel)
      ? (query.level as BALevel)
      : undefined;
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
      ...(currentUser.role === UserRole.BA
        ? { user_id: currentUser.id, status: { not: BAStatus.RESIGNED } }
        : {}),
      ...(statusFilter && canViewPrivateBaFields(currentUser.role) ? { status: statusFilter } : {}),
      ...(levelFilter ? { level: levelFilter } : {}),
      ...(search
        ? {
            OR: [
              { full_name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } }
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

    const bas = await this.prisma.bAProfile.findMany({
      where,
      orderBy: [{ status: 'asc' }, { full_name: 'asc' }],
      include: {
        skill_tags: { include: { tag: true } },
        bookings: {
          where: {
            status: { in: ['APPROVED', 'IN_PROGRESS', 'PENDING'] },
            end_date: { gte: timeframe.startDate },
            start_date: { lte: timeframe.endDate }
          },
          include: { project: true, requester: { select: safeUserSelect } }
        }
      }
    });

    return bas.map((ba) => {
      const capacity = getRangeCapacity(ba.bookings, timeframe.startDate, timeframe.endDate);
      const availableManDays = ba.status === BAStatus.ACTIVE ? workingDays : 0;
      const bookedManDays = calculateBookedWorkingDays(
        ba.bookings,
        timeframe.startDate,
        timeframe.endDate
      );
      const utilizationPercent = calculateUtilizationPercent(bookedManDays, availableManDays);
      const capacityLabel = capacity.max_risk_capacity > 100
        ? 'OVERBOOKED'
        : classifyCapacity(utilizationPercent);

      return {
        ...ba,
        timeframe: {
          from: toDateKey(timeframe.startDate),
          to: toDateKey(timeframe.endDate)
        },
        approved_capacity: capacity.max_approved_capacity,
        pending_capacity: capacity.max_pending_capacity,
        risk_capacity: capacity.max_risk_capacity,
        booked_man_days: Number(bookedManDays.toFixed(2)),
        available_man_days: availableManDays,
        utilization_percent: utilizationPercent,
        capacity_label: capacityLabel,
        current_projects: this.summarizeCurrentProjects(ba.bookings)
      };
    });
  }

  async create(currentUser: User, input: CreateBAInput) {
    this.ensureManager(currentUser);

    const email = requireString(input.email, 'email').toLowerCase();
    const password = this.readInitialPassword(input.password);
    const existing = await this.prisma.bAProfile.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('BA email already exists');
    }
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('User email already exists');
    }

    const fullName = requireString(input.full_name, 'full_name');
    const joinedDate = input.joined_date ? requireDate(input.joined_date, 'joined_date') : new Date();
    const avatarUrl = optionalString(input.avatar_url);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          full_name: fullName,
          email,
          role: UserRole.BA,
          password_hash: await hashPassword(password),
          avatar_url: avatarUrl
        }
      });

      return tx.bAProfile.create({
        data: {
          user_id: user.id,
          full_name: fullName,
          email,
          phone: optionalString(input.phone),
          level: input.level ?? BALevel.MIDDLE,
          joined_date: joinedDate,
          avatar_url: avatarUrl,
          status: input.status ?? BAStatus.ACTIVE
        },
        include: { skill_tags: { include: { tag: true } } }
      });
    });

    await this.audit(currentUser, 'CREATE_BA_ACCOUNT', 'BAProfile', created.id, null, {
      id: created.id,
      email: created.email,
      user_id: created.user_id
    });

    return created;
  }

  async getById(currentUser: User, id: string) {
    await syncBookingStatuses(this.prisma);
    const ba = await this.prisma.bAProfile.findUnique({
      where: { id },
      include: {
        skill_tags: { include: { tag: true } },
        bookings: {
          include: {
            project: true,
            requester: { select: safeUserSelect },
            manager: { select: safeUserSelect }
          },
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

    if (currentUser.role === UserRole.BA && ba.status === BAStatus.RESIGNED) {
      throw new ForbiddenException('Resigned BA profile is not available for self-view');
    }

    if (!canViewPrivateBaFields(currentUser.role)) {
      return this.toPublicProfile(ba);
    }

    return ba;
  }

  async update(currentUser: User, id: string, input: Partial<CreateBAInput>) {
    this.ensureManager(currentUser);
    const existing = await this.getExisting(id);

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

    const status = input.status ?? BAStatus.ACTIVE;
    const updated = await this.prisma.bAProfile.update({
      where: { id },
      data: {
        status,
        status_reason: optionalString(input.status_reason ?? (input as { reason?: string }).reason),
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

    return this.toPublicProfile(ba);
  }

  private toPublicProfile(ba: {
    id: string;
    full_name: string;
    level: BALevel;
    avatar_url: string | null;
    status: BAStatus;
    skill_tags: Array<
      | {
          tag: {
            id: string;
            name: string;
            group: string;
            status: string;
          };
        }
      | {
          id: string;
          name: string;
          group: string;
          status: string;
        }
    >;
  }) {
    return {
      id: ba.id,
      full_name: ba.full_name,
      level: ba.level,
      avatar_url: ba.avatar_url,
      status: ba.status,
      skill_tags: ba.skill_tags.map((item) => {
        const tag = 'tag' in item ? item.tag : item;
        return {
          id: tag.id,
          name: tag.name,
          group: tag.group,
          status: tag.status
        };
      })
    };
  }

  async bookingHistory(currentUser: User, id: string) {
    await this.getById(currentUser, id);

    return this.prisma.booking.findMany({
      where: { ba_id: id },
      include: {
        project: true,
        requester: { select: safeUserSelect },
        manager: { select: safeUserSelect }
      },
      orderBy: { start_date: 'desc' }
    });
  }

  async utilization(currentUser: User, id: string, month = '2026-06', from?: string, to?: string) {
    await this.getById(currentUser, id);

    const { startDate, endDate } = from || to
      ? this.resolveTimeframe(from, to)
      : monthRange(month);
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

  private resolveTimeframe(from?: string, to?: string) {
    if (from || to) {
      if (!from || !to) {
        throw new BadRequestException('from and to must be provided together');
      }

      const startDate = parseDateOnly(from);
      const endDate = parseDateOnly(to);
      if (startDate > endDate) {
        throw new BadRequestException('from must be before or equal to to');
      }

      return { startDate, endDate };
    }

    const now = new Date();
    return {
      startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    };
  }

  private summarizeCurrentProjects<
    TBooking extends {
      project_id: string;
      project: { id: string; name: string; color: string };
      capacity_percent: number;
    }
  >(bookings: TBooking[]) {
    const projectMap = new Map<
      string,
      {
        project_id: string;
        project_name: string;
        color: string;
        capacity_percent: number;
      }
    >();

    for (const booking of bookings) {
      const current = projectMap.get(booking.project_id) ?? {
        project_id: booking.project.id,
        project_name: booking.project.name,
        color: booking.project.color,
        capacity_percent: 0
      };
      current.capacity_percent += booking.capacity_percent;
      projectMap.set(booking.project_id, current);
    }

    return Array.from(projectMap.values()).sort(
      (left, right) => right.capacity_percent - left.capacity_percent
    );
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

    if (!tagId) {
      throw new BadRequestException('tag_id is required');
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        tagId
      )
    ) {
      throw new BadRequestException('tag_id must be a valid UUID of an existing active tag');
    }

    const tag = await this.prisma.skillTag.findFirst({
      where: { id: tagId, status: SkillTagStatus.ACTIVE }
    });
    if (!tag) {
      throw new BadRequestException('Active tag_id does not exist');
    }

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

  async getAuditLogs(currentUser: User, id: string) {
    this.ensureManager(currentUser);
    await this.getExisting(id);

    return this.prisma.auditLog.findMany({
      where: { target_type: 'BAProfile', target_id: id },
      include: { actor: { select: safeUserSelect } },
      orderBy: { created_at: 'desc' }
    });
  }

  async listNotes(currentUser: User, baId: string) {
    if (!canReadPrivateNotes(currentUser.role)) {
      await this.auditDenied(currentUser, 'READ_PRIVATE_NOTES', 'BAProfile', baId);
      throw new ForbiddenException('Manager or Admin support role required');
    }

    return this.prisma.privateNote.findMany({
      where: { ba_id: baId },
      include: { creator: { select: safeUserSelect } },
      orderBy: { created_at: 'desc' }
    });
  }

  async appendNote(currentUser: User, baId: string, input: { content?: string }) {
    if (!isManagerRole(currentUser.role)) {
      await this.auditDenied(currentUser, 'APPEND_PRIVATE_NOTE', 'BAProfile', baId);
      throw new ForbiddenException('BA Manager role required');
    }

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
      include: { creator: { select: safeUserSelect } }
    });

    await this.audit(currentUser, 'APPEND_PRIVATE_NOTE', 'BAProfile', baId, null, {
      note_id: note.id
    });
    return note;
  }

  private ensureManager(user: User) {
    if (!isManagerRole(user.role)) {
      throw new ForbiddenException('BA Manager role required');
    }
  }

  private readInitialPassword(value: unknown) {
    const password = requireString(value, 'password');
    if (password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters.');
    }

    return password;
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

  private async auditDenied(user: User, action: string, targetType: string, targetId: string) {
    await this.prisma.auditLog
      .create({
        data: {
          actor_id: user.id,
          action,
          target_type: targetType,
          target_id: targetId,
          result: 'DENIED'
        }
      })
      .catch(() => undefined);
  }
}
