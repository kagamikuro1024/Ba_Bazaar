import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const webPort = configService.get<string>('WEB_PORT') ?? '5173';
  const devWebPorts = Array.from(
    new Set([
      webPort,
      '5173',
      '5174',
      '5175',
      '5176',
      '5177',
      '5178',
      '5179'
    ])
  ).join('|');
  const corsOriginEnv = configService.get<string>('CORS_ORIGIN');
  const configuredOrigins = corsOriginEnv
    ? corsOriginEnv
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  function isAllowedLanOrigin(origin: string) {
    return new RegExp(
      `^http://(?:localhost|127\\.0\\.0\\.1|10(?:\\.\\d{1,3}){3}|172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2}|192\\.168(?:\\.\\d{1,3}){2}):(?:${devWebPorts})$`
    ).test(origin);
  }

  app.enableCors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (configuredOrigins.includes(origin) || (!isProduction && isAllowedLanOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin ${origin}`), false);
    },
    credentials: true
  });

  const apiPort = Number(configService.get<string>('API_PORT') ?? 3000);
  await app.listen(apiPort, '0.0.0.0');
}

void bootstrap();
