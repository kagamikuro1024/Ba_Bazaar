import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const webPort = configService.get<string>('WEB_PORT') ?? '5173';
  const corsOriginEnv = configService.get<string>('CORS_ORIGIN');
  const corsOrigins = corsOriginEnv
    ? corsOriginEnv
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`];

  app.enableCors({
    origin: corsOrigins,
    credentials: true
  });

  const apiPort = Number(configService.get<string>('API_PORT') ?? 3000);
  await app.listen(apiPort);
}

void bootstrap();
