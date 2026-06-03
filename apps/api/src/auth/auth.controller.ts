import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Controller('api')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('auth/register')
  register(@Body() body: Record<string, unknown>) {
    return this.authService.register(body);
  }

  @Post('auth/login')
  login(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return this.authService.login(body, request);
  }

  @Post('auth/refresh')
  refresh(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return this.authService.refresh(body, request);
  }

  @Post('auth/logout')
  @HttpCode(200)
  logout(@Body() body: Record<string, unknown>) {
    return this.authService.logout(body);
  }

  @Get('auth/me')
  async getAuthMe(@Req() request: Request) {
    const user = await this.authService.getCurrentUser(request);

    return { user: this.authService.toUserView(user) };
  }

  @Get('me')
  async getMe(@Req() request: Request) {
    const user = await this.authService.getCurrentUser(request);

    return { user: this.authService.toUserView(user) };
  }
}
