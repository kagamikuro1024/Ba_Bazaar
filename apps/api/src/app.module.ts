import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { BAController } from './ba/ba.controller';
import { BAService } from './ba/ba.service';
import { BookingsController } from './bookings/bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { CapacityController } from './capacity/capacity.controller';
import { CapacityService } from './capacity/capacity.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { PrismaService } from './prisma/prisma.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env']
    }),
    JwtModule.register({})
  ],
  controllers: [
    HealthController,
    AuthController,
    BAController,
    BookingsController,
    CapacityController,
    ProjectsController,
    ReportsController,
    NotificationsController
  ],
  providers: [
    PrismaService,
    AuthService,
    BAService,
    BookingsService,
    CapacityService,
    ProjectsService,
    ReportsService,
    NotificationsService
  ]
})
export class AppModule {}
