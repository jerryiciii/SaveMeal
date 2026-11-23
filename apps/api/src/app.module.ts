import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ImagesModule } from './images/images.module';
import { ListingsModule } from './listings/listings.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, MeModule, ImagesModule, ListingsModule, SystemModule],
})
export class AppModule {}
