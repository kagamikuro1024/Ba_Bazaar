import { Inject, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(currentUser: User) {
    return this.prisma.notification.findMany({
      where: { recipient_id: currentUser.id },
      orderBy: { created_at: 'desc' }
    });
  }

  async markRead(currentUser: User, id: string) {
    return this.prisma.notification.update({
      where: { id, recipient_id: currentUser.id },
      data: { read_at: new Date() }
    });
  }
}
