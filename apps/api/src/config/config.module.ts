import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config';
import { parseEnv } from './env';

@Global()
@Module({
  imports: [
    // Loads apps/api/.env (if present) into process.env. Real env vars win over the file.
    NestConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'], cache: true }),
  ],
  providers: [{ provide: AppConfig, useFactory: () => new AppConfig(parseEnv(process.env)) }],
  exports: [AppConfig],
})
export class ConfigModule {}
