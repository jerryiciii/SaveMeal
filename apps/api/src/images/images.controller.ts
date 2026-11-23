import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMAGE_PURPOSES, type Image, type ImagePurpose } from '@savemeal/shared';
import { IsIn } from 'class-validator';
import { memoryStorage } from 'multer';
import { CurrentAccount, type AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { ImagesService, MAX_UPLOAD_BYTES } from './images.service';

class UploadImageDto {
  @IsIn(IMAGE_PURPOSES)
  purpose: ImagePurpose;
}

@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  /** IMG-1 · POST /images (multipart: file + purpose). Oversize → 413 IMAGE_TOO_LARGE. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }),
  )
  async upload(
    @CurrentAccount() account: AuthAccount,
    @Body() body: UploadImageDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ data: Image }> {
    if (!file) throw new AppException('VALIDATION_FAILED', { fields: { file: 'file is required' } });
    return { data: await this.images.upload(account.id, body.purpose, file) };
  }

  /** IMG-2 · DELETE /images/{imageId} (the uploader). */
  @Delete(':imageId')
  @HttpCode(204)
  async remove(
    @CurrentAccount() account: AuthAccount,
    @Param('imageId', new ParseUUIDPipe({ exceptionFactory: () => new AppException('IMAGE_NOT_FOUND') })) imageId: string,
  ): Promise<void> {
    await this.images.remove(account.id, imageId);
  }
}
