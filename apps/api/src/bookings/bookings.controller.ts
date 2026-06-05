import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { BookingStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { BookingsService } from './bookings.service';

@Controller('api/bookings')
export class BookingsController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(BookingsService)
    private readonly bookingsService: BookingsService
  ) {}

  @Get()
  async list(@Req() request: Request, @Query() query: Record<string, string | undefined>) {
    return this.bookingsService.list(await this.authService.getCurrentUser(request), query);
  }

  @Post('request')
  async createRequest(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.bookingsService.createRequest(
      await this.authService.getCurrentUser(request),
      body
    );
  }

  @Post('direct')
  async createDirect(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.bookingsService.createDirect(await this.authService.getCurrentUser(request), body);
  }

  @Get('my-requests')
  async myRequests(@Req() request: Request, @Query('status') status?: BookingStatus) {
    return this.bookingsService.myRequests(
      await this.authService.getCurrentUser(request),
      status
    );
  }

  @Get('my-schedule')
  async mySchedule(@Req() request: Request) {
    return this.bookingsService.mySchedule(await this.authService.getCurrentUser(request));
  }

  @Get(':id')
  async getById(@Req() request: Request, @Param('id') id: string) {
    return this.bookingsService.getById(await this.authService.getCurrentUser(request), id);
  }

  @Patch(':id')
  async update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.bookingsService.update(await this.authService.getCurrentUser(request), id, body);
  }

  @Post(':id/approve')
  async approve(@Req() request: Request, @Param('id') id: string) {
    return this.bookingsService.approve(await this.authService.getCurrentUser(request), id);
  }

  @Patch(':id/assign')
  async assign(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.bookingsService.assign(await this.authService.getCurrentUser(request), id, body);
  }

  @Post(':id/reject')
  async reject(
    @Req() request: Request,
    @Param('id') id: string,
    @Body('reject_reason') reason?: string
  ) {
    return this.bookingsService.reject(await this.authService.getCurrentUser(request), id, reason);
  }

  @Post(':id/changes/approve')
  async approveChanges(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.bookingsService.approveChanges(await this.authService.getCurrentUser(request), id, body);
  }

  @Post(':id/changes/reject')
  async rejectChanges(
    @Req() request: Request,
    @Param('id') id: string,
    @Body('reject_reason') reason?: string
  ) {
    return this.bookingsService.rejectChanges(await this.authService.getCurrentUser(request), id, reason);
  }

  @Post(':id/changes/approve-fields')
  async approveFields(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { fields: string[]; overrides?: Record<string, unknown> }
  ) {
    return this.bookingsService.approveFields(
      await this.authService.getCurrentUser(request),
      id,
      body.fields,
      body.overrides
    );
  }

  @Post(':id/changes/reject-fields')
  async rejectFields(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { fields: string[] }
  ) {
    return this.bookingsService.rejectFields(
      await this.authService.getCurrentUser(request),
      id,
      body.fields
    );
  }

  @Post(':id/cancel')
  async cancel(
    @Req() request: Request,
    @Param('id') id: string,
    @Body('cancel_reason') reason?: string
  ) {
    return this.bookingsService.cancel(await this.authService.getCurrentUser(request), id, reason);
  }
}
