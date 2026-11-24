import { Injectable, Logger } from '@nestjs/common';
import type { ImagePurpose } from '@prisma/client';
import type { Image } from '@savemeal/shared';
import sharp from 'sharp';
import { AppException } from '../common/errors/app-exception';
import { toImage } from '../common/images';
import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 1600;
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
  ) {}

  /**
   * IMG-1. Decodes the upload (the real type check), applies the EXIF orientation, re-encodes to
   * webp at most 1600 px and writes it WITHOUT any metadata: sharp drops EXIF/GPS/XMP/ICC unless
   * asked to keep them (CLAUDE.md §7). The platform never judges food quality from images.
   */
  async upload(uploaderId: string, purpose: ImagePurpose, file: { buffer: Buffer; mimetype: string }): Promise<Image> {
    if (!ACCEPTED_MIME.has(file.mimetype)) throw new AppException('IMAGE_TYPE_UNSUPPORTED');
    let output: { data: Buffer; info: { width: number; height: number } };
    try {
      const input = sharp(file.buffer, { failOn: 'error', limitInputPixels: 50_000_000 });
      const meta = await input.metadata();
      if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) throw new Error(`format ${meta.format}`);
      output = await input
        .rotate()
        .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      this.logger.debug(`rejected upload: ${(error as Error).message}`);
      throw new AppException('IMAGE_TYPE_UNSUPPORTED');
    }

    const storageKey = this.storage.newKey();
    await this.storage.write(storageKey, output.data);
    const row = await this.prisma.listingImage.create({
      data: {
        uploaderId,
        purpose,
        storageKey,
        width: output.info.width,
        height: output.info.height,
        bytes: output.data.length,
      },
    });
    return toImage(row);
  }

  /** IMG-2. Only the uploader; refused while the image is on a published listing or a report. */
  async remove(uploaderId: string, imageId: string): Promise<void> {
    const image = await this.prisma.listingImage.findFirst({
      where: { id: imageId, uploaderId },
      include: { listing: { select: { status: true } } },
    });
    if (!image) throw new AppException('IMAGE_NOT_FOUND');
    const onPublished = image.listing !== null && image.listing.status !== 'DRAFT';
    const onReport = (await this.prisma.report.count({ where: { imageIds: { has: imageId } } })) > 0;
    if (onPublished || onReport) throw new AppException('IMAGE_IN_USE');
    await this.prisma.listingImage.delete({ where: { id: imageId } });
    await this.storage.remove(image.storageKey);
  }
}
