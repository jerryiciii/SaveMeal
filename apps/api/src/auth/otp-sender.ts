import { Injectable, Logger } from '@nestjs/common';
import type { OtpChannel } from '@savemeal/shared';
import { maskIdentifier } from './identifier';

/** Delivers OTP codes. Pluggable: an SMS or email provider implements this interface. */
export interface OtpSender {
  send(channel: OtpChannel, identifier: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/**
 * Development provider: writes the code to the server log. Config validation refuses to boot in
 * production with OTP_PROVIDER=console.
 */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('OTP');

  async send(channel: OtpChannel, identifier: string, code: string): Promise<void> {
    this.logger.warn(`[console OTP] ${channel} ${maskIdentifier(identifier)} → code ${code}`);
  }
}
