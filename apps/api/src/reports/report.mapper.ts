import type { Prisma, Report as ReportModel } from '@prisma/client';
import type { Image, Report } from '@savemeal/shared';
import { toImage } from '../common/images';
import { toApiTime, toApiTimeOrNull } from '../common/time';

export type ReportRow = ReportModel & {
  reporter?: { id: string; displayName: string | null } | null;
};

type ImageReader = Pick<Prisma.TransactionClient, 'listingImage'>;

/** Loads all images referenced by one or more reports in a single query. */
export async function loadReportImagesMap(
  db: ImageReader,
  reports: ReadonlyArray<Pick<ReportModel, 'imageIds'>>,
): Promise<Map<string, Image>> {
  const ids = [...new Set(reports.flatMap((r) => r.imageIds))];
  if (ids.length === 0) return new Map();
  const rows = await db.listingImage.findMany({
    where: { id: { in: ids } },
    select: { id: true, storageKey: true, width: true, height: true },
  });
  return new Map(rows.map((row) => [row.id, toImage(row)]));
}

/** Maps a Report DB row to the contract Report DTO. `reporter` is populated for ADMIN only. */
export function toReport(
  row: ReportRow,
  imagesMap: Map<string, Image>,
  includeReporter: boolean,
): Report {
  const images = row.imageIds
    .map((id) => imagesMap.get(id))
    .filter((img): img is Image => img !== undefined);

  return {
    id: row.id,
    type: row.type,
    description: row.description,
    images,
    listingId: row.listingId,
    reservationId: row.reservationId,
    reportedAccountId: row.reportedAccountId,
    status: row.status,
    action: row.action,
    resolution: row.resolution,
    createdAt: toApiTime(row.createdAt),
    handledAt: toApiTimeOrNull(row.handledAt),
    reporter:
      includeReporter && row.reporter
        ? { id: row.reporter.id, displayName: row.reporter.displayName ?? 'Người dùng' }
        : null,
  };
}
