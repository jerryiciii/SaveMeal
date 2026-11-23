import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  const config = app.get(AppConfig);
  const levels = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
  app.useLogger(levels.slice(0, levels.indexOf(config.logLevel) + 1));
  await app.listen(config.port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${config.port}/${API_PREFIX}`);
}

void bootstrap();
