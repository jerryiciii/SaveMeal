import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, MeModule, SystemModule],
})
export class AppModule {}
