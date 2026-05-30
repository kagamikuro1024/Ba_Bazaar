import { Controller, Get, Inject, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Controller('api')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get('me')
  async getMe(@Req() request: Request) {
    const user = await this.authService.getCurrentUser(request);

    return { user };
  }
}
