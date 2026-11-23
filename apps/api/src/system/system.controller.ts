import { Controller, Get, Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

/** Version of the API contract this server implements. */
export const API_VERSION = '1.0.0';

@Controller()
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(private readonly prisma: PrismaService) {}

  /** SYS-1 · GET /health (PUBLIC). A database failure is reported as 500 INTERNAL. */
  @Get('health')
  async health(): Promise<{ data: { status: 'ok'; db: 'ok'; version: string } }> {
    try {
      await this.prisma.ping();
    } catch (error) {
      this.logger.error(`health: database unreachable: ${(error as Error).message}`);
      throw new AppException('INTERNAL');
    }
    return { data: { status: 'ok', db: 'ok', version: API_VERSION } };
  }
}
