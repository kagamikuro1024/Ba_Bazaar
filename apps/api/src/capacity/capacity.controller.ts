import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { CapacityService } from './capacity.service';

@Controller('api/capacity')
export class CapacityController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(CapacityService)
    private readonly capacityService: CapacityService
  ) {}

  @Get('summary')
  async summary(
    @Req() request: Request,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string
  ) {
    return this.capacityService.summary(
      await this.authService.getCurrentUser(request),
      startDate,
      endDate
    );
  }

  @Get('ba/:baId')
  async baCapacity(
    @Req() request: Request,
    @Param('baId') baId: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string
  ) {
    return this.capacityService.baCapacity(
      await this.authService.getCurrentUser(request),
      baId,
      startDate,
      endDate
    );
  }

  @Get('range-check')
  async rangeCheck(@Query() query: Record<string, string | undefined>) {
    return this.capacityService.rangeCheck(query);
  }
}
