import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { ReportsService } from './reports.service';

@Controller('api/reports')
export class ReportsController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ReportsService)
    private readonly reportsService: ReportsService
  ) {}

  @Get('utilization')
  async utilization(@Req() request: Request, @Query('month') month?: string) {
    return this.reportsService.utilization(await this.authService.getCurrentUser(request), month);
  }

  @Get('utilization.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ba-utilization.csv"')
  async utilizationCsv(@Req() request: Request, @Query('month') month?: string) {
    return this.reportsService.utilizationCsv(
      await this.authService.getCurrentUser(request),
      month
    );
  }
}
