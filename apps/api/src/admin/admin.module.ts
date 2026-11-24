import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ListingsModule, AuthModule, ReportsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
