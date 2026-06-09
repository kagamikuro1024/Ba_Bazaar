import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { ReportsService } from '../reports/reports.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ReportsService)
    private readonly reportsService: ReportsService
  ) {}

  @Get('manager-summary')
  async managerSummary(
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.reportsService.managerSummary(
      await this.authService.getCurrentUser(request),
      from,
      to
    );
  }
}
