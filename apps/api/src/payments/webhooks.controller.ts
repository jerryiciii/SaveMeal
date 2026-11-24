import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Public } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { flattenValidationErrors } from '../common/validation';
import { SePayWebhookDto } from './payment.dto';
import { PaymentsService } from './payments.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /** PAY-2 · POST /webhooks/sepay (WEBHOOK auth via Authorization: Apikey <secret>). */
  @Post('sepay')
  @Public()
  @HttpCode(200)
  async handleSePay(
    @Headers('authorization') authHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<{ data: { received: true } }> {
    // Authenticate before validating the payload so unauthenticated callers always receive 401.
    this.payments.verifyWebhookAuth(authHeader);

    const dto = plainToInstance(SePayWebhookDto, rawBody ?? {});
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
      stopAtFirstError: true,
    });
    if (errors.length > 0) {
      throw new AppException('VALIDATION_FAILED', { fields: flattenValidationErrors(errors) });
    }

    return { data: await this.payments.handleSePayWebhook(authHeader, dto) };
  }
}
