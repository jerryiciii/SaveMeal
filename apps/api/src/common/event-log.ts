import type { ActorType, Prisma } from '@prisma/client';

type Tx = Pick<Prisma.TransactionClient, 'eventLog'>;

export type EventInput = {
  actorId: string | null;
  actorType: ActorType;
  event: string;
  entityType: 'account' | 'listing' | 'reservation' | 'payment' | 'report' | 'image';
  entityId: string;
  data?: Prisma.InputJsonValue;
};

/** Appends one event_log row (DOMAIN §2: every state transition writes one). Use inside the tx. */
export function logEvent(tx: Tx, input: EventInput) {
  return tx.eventLog.create({ data: { ...input, data: input.data ?? {} } });
}
