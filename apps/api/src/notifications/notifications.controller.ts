import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
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
  async list(@Req() request: Request) {
    return this.notificationsService.list(await this.authService.getCurrentUser(request));
  }

  @Post(':id/read')
  async markRead(@Req() request: Request, @Param('id') id: string) {
    return this.notificationsService.markRead(await this.authService.getCurrentUser(request), id);
  }
}
