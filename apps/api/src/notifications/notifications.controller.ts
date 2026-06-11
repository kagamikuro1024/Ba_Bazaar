import { Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';

@Controller('api/notifications')
export class NotificationsController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService
  ) {}

  @Get()
  async list(
    @Req() request: Request,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string
  ) {
    return this.notificationsService.list(
      await this.authService.getCurrentUser(request),
      page,
      pageSize
    );
  }

  @Post(':id/read')
  async markRead(@Req() request: Request, @Param('id') id: string) {
    return this.notificationsService.markRead(await this.authService.getCurrentUser(request), id);
  }

  @Post('reminders/run')
  async runReminders(@Req() request: Request, @Query('date') date?: string) {
    return this.notificationsService.runReminders(
      await this.authService.getCurrentUser(request),
      date
    );
  }
}
