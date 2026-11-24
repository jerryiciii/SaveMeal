import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { JobsService } from './jobs.service';

@Module({
  controllers: [CronController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
