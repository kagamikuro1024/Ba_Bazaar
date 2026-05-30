import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { BAService } from './ba.service';

@Controller('api')
export class BAController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(BAService)
    private readonly baService: BAService
  ) {}

  @Get('ba')
  async list(@Req() request: Request, @Query() query: Record<string, string>) {
    return this.baService.list(await this.authService.getCurrentUser(request), query);
  }

  @Post('ba')
  async create(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.baService.create(await this.authService.getCurrentUser(request), body);
  }

  @Get('ba/:id')
  async getById(@Req() request: Request, @Param('id') id: string) {
    return this.baService.getById(await this.authService.getCurrentUser(request), id);
  }

  @Patch('ba/:id')
  async update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.baService.update(await this.authService.getCurrentUser(request), id, body);
  }

  @Patch('ba/:id/status')
  async changeStatus(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.baService.changeStatus(await this.authService.getCurrentUser(request), id, body);
  }

  @Get('ba/:id/public-card')
  async publicCard(@Req() request: Request, @Param('id') id: string) {
    return this.baService.publicCard(await this.authService.getCurrentUser(request), id);
  }

  @Get('ba/:id/booking-history')
  async bookingHistory(@Req() request: Request, @Param('id') id: string) {
    return this.baService.bookingHistory(await this.authService.getCurrentUser(request), id);
  }

  @Get('ba/:id/utilization')
  async utilization(
    @Req() request: Request,
    @Param('id') id: string,
    @Query('month') month?: string
  ) {
    return this.baService.utilization(await this.authService.getCurrentUser(request), id, month);
  }

  @Get('tags')
  async tags() {
    return this.baService.listTags();
  }

  @Post('ba/:id/tags')
  async addTag(
    @Req() request: Request,
    @Param('id') id: string,
    @Body('tag_id') tagId: string
  ) {
    return this.baService.addTag(await this.authService.getCurrentUser(request), id, tagId);
  }

  @Delete('ba/:id/tags/:tagId')
  async removeTag(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('tagId') tagId: string
  ) {
    return this.baService.removeTag(await this.authService.getCurrentUser(request), id, tagId);
  }

  @Get('ba/:id/notes')
  async notes(@Req() request: Request, @Param('id') id: string) {
    return this.baService.listNotes(await this.authService.getCurrentUser(request), id);
  }

  @Post('ba/:id/notes')
  async appendNote(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.baService.appendNote(await this.authService.getCurrentUser(request), id, body);
  }
}
