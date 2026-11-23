import type { ValidationError } from '@nestjs/common';
import { flattenValidationErrors } from './validation';

describe('flattenValidationErrors', () => {
  it('produces dotted paths with the first reason per field', () => {
    const errors: ValidationError[] = [
      { property: 'title', constraints: { minLength: 'title must be longer', isString: 'x' }, children: [] },
      {
        property: 'items',
        children: [
          { property: '0', children: [{ property: 'qty', constraints: { min: 'qty must be ≥ 1' }, children: [] }] },
        ],
      },
    ];
    expect(flattenValidationErrors(errors)).toEqual({
      title: 'title must be longer',
      'items.0.qty': 'qty must be ≥ 1',
    });
  });

  it('returns an empty map for no errors', () => {
    expect(flattenValidationErrors([])).toEqual({});
  });
});
