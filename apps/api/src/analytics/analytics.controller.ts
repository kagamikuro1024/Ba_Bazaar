import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { ReportsService } from '../reports/reports.service';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ReportsService)
    private readonly reportsService: ReportsService
  ) {}

  @Get('team-utilization')
  async teamUtilization(
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.reportsService.teamUtilization(
      await this.authService.getCurrentUser(request),
      from,
      to
    );
  }

  @Get('project-effort')
  async projectEffort(
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.reportsService.projectEffort(
      await this.authService.getCurrentUser(request),
      from,
      to
    );
  }
}
