import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALLERGENS,
  BUYER_CANCEL_REASONS,
  CANCEL_REASONS,
  CATEGORIES,
  CHECKLIST_KEYS,
  DECLARATION_KEYS,
  LISTING_STATUSES,
  REPORT_TYPES,
  RESERVATION_STATUSES,
  SELLER_TYPES,
  STORAGES,
} from './enums';

const contract = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');

/** Reads `type Name = "A" | "B" …;` from contract §1 (may span lines). */
function contractUnion(name: string): string[] {
  const match = new RegExp(`type ${name} = ([^;]+);`).exec(contract);
  if (!match) throw new Error(`type ${name} not found in the contract`);
  return [...match[1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
}

// Guards against drift: the contract is the source of truth, this package only mirrors it.
describe('enums mirror docs/API_CONTRACT.md §1', () => {
  it.each([
    ['SellerType', SELLER_TYPES],
    ['Category', CATEGORIES],
    ['Storage', STORAGES],
    ['Allergen', ALLERGENS],
    ['ListingStatus', LISTING_STATUSES],
    ['ReservationStatus', RESERVATION_STATUSES],
    ['CancelReason', CANCEL_REASONS],
    ['ReportType', REPORT_TYPES],
    ['DeclarationKey', DECLARATION_KEYS],
    ['ChecklistKey', CHECKLIST_KEYS],
  ] as const)('%s', (name, values) => {
    expect([...values]).toEqual(contractUnion(name));
  });

  it('buyer cancel reasons are the first four cancel reasons (RES-4)', () => {
    expect([...BUYER_CANCEL_REASONS]).toEqual(CANCEL_REASONS.slice(0, 4));
  });
});
