// TFL-1148 - packaged-vs-dev runtime signal.
//
// The renderer gate reads `window.tflex.app.isPackaged` synchronously. Main
// encodes its `app.isPackaged` into an env carrier and the sandboxed preload
// decodes it. These pure helpers are the encode/decode pair; this test pins
// them without booting Electron.

import { describe, expect, it } from 'vitest';
import {
  TFLEX_PACKAGED_ENV,
  encodePackagedFlag,
  parsePackagedFlag,
} from '../../../src/shared/packagedSignal';

describe('packaged runtime signal', () => {
  it('carrier name is the fixed TFLEX_PACKAGED variable', () => {
    expect(TFLEX_PACKAGED_ENV).toBe('TFLEX_PACKAGED');
  });

  it('encodes a packaged app as the packed marker', () => {
    expect(encodePackagedFlag(true)).toBe('1');
  });

  it('encodes an unpackaged run as the development marker', () => {
    expect(encodePackagedFlag(false)).toBe('0');
  });

  it('decodes the packed marker as true (packaged)', () => {
    expect(parsePackagedFlag('1')).toBe(true);
  });

  it('decodes the development marker as false (unpackaged)', () => {
    expect(parsePackagedFlag('0')).toBe(false);
  });

  it('treats a missing carrier as unpackaged', () => {
    expect(parsePackagedFlag(undefined)).toBe(false);
  });

  it('round-trips both states through encode then decode', () => {
    expect(parsePackagedFlag(encodePackagedFlag(true))).toBe(true);
    expect(parsePackagedFlag(encodePackagedFlag(false))).toBe(false);
  });
});
