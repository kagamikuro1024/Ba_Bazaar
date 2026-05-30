import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { ProjectsService } from './projects.service';

@Controller('api/projects')
export class ProjectsController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ProjectsService)
    private readonly projectsService: ProjectsService
  ) {}

  @Get()
  async list() {
    return this.projectsService.list();
  }

  @Post()
  async create(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.projectsService.create(await this.authService.getCurrentUser(request), body);
  }
}
