import { Body, Controller, Post } from '@nestjs/common';
import type { Report } from '@savemeal/shared';
import { CurrentAccount, type AuthAccount } from '../auth/auth.guard';
import { CreateReportDto } from './report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** REP-1 · POST /reports */
  @Post()
  async create(@CurrentAccount() account: AuthAccount, @Body() body: CreateReportDto): Promise<{ data: Report }> {
    return { data: await this.reports.create(account, body) };
  }
}
