import { redactUrlForLog, roundCoordinate } from './redact';

describe('redactUrlForLog', () => {
  it('rounds lat and lng to 2 decimals and keeps other params', () => {
    expect(redactUrlForLog('/api/v1/batches?lat=16.054412&lng=108.202167&radiusKm=3&q=b%C3%A1nh')).toBe(
      '/api/v1/batches?lat=16.05&lng=108.20&radiusKm=3&q=b%C3%A1nh',
    );
  });

  it('handles alternative key names and repeated keys', () => {
    expect(redactUrlForLog('/x?Latitude=16.0599&longitude=108.2&lon=1.23456&lat=1.111&lat=2.229')).toBe(
      '/x?Latitude=16.06&longitude=108.20&lon=1.23&lat=1.11&lat=2.23',
    );
  });

  it('never echoes a malformed coordinate', () => {
    expect(redactUrlForLog('/x?lat=16.054412abc')).toBe('/x?lat=%5Bredacted%5D');
  });

  it('leaves URLs without coordinates unchanged', () => {
    expect(redactUrlForLog('/api/v1/health')).toBe('/api/v1/health');
    expect(redactUrlForLog('/api/v1/batches?view=map')).toBe('/api/v1/batches?view=map');
  });
});

describe('roundCoordinate', () => {
  it.each([
    ['16.054412', '16.05'],
    ['-16.054', '-16.05'],
    ['108', '108.00'],
    ['', ''],
  ])('%p → %p', (input, output) => {
    expect(roundCoordinate(input)).toBe(output);
  });
});
