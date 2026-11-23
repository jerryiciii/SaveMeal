import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES, ERROR_HTTP_STATUS, isErrorCode } from './errors';

/** Parses the error catalogue table of docs/API_CONTRACT.md into code → HTTP status. */
function readContractErrorCatalogue(): Map<string, number> {
  const contract = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');
  const section = contract.split(/^## \d+\. Error code catalogue/m)[1]?.split('\n## ')[0] ?? '';
  const catalogue = new Map<string, number>();
  for (const line of section.split('\n')) {
    const match = /^\|\s*(\d{3})\s*\|([^|]+)\|/.exec(line);
    if (!match) continue;
    for (const code of match[2]!.matchAll(/`([A-Z_]+)`/g)) {
      catalogue.set(code[1]!, Number(match[1]));
    }
  }
  return catalogue;
}

// Guards against drift: the contract is the source of truth, this package only mirrors it.
describe('error catalogue', () => {
  it('matches the contract catalogue exactly (codes and HTTP statuses)', () => {
    const contract = readContractErrorCatalogue();
    expect(contract.size).toBeGreaterThan(0);
    expect(Object.fromEntries(ERROR_CODES.map((c) => [c, ERROR_HTTP_STATUS[c]]))).toEqual(
      Object.fromEntries(contract),
    );
  });

  it('recognises codes', () => {
    expect(isErrorCode('VALIDATION_FAILED')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
  });
});
