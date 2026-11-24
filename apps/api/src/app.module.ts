import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ImagesModule } from './images/images.module';
import { JobsModule } from './jobs/jobs.module';
import { ListingsModule } from './listings/listings.module';
import { MeModule } from './me/me.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    PrismaModule,
    AuthModule,
    MeModule,
    ImagesModule,
    ListingsModule,
    PaymentsModule,
    ReservationsModule,
    ReportsModule,
    AdminModule,
    JobsModule,
    SystemModule,
  ],
})
export class AppModule {}
