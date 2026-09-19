import { afterEach, expect, it, vi } from 'vitest';
import { printTrip } from '../src/export';
import { fixture } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

it('brands printable and PDF summaries as Ensemble', () => {
  let html = '';
  const popup = {
    opener: null,
    document: {
      write: (content: string) => {
        html = content;
      },
      close: vi.fn(),
    },
    focus: vi.fn(),
    print: vi.fn(),
  };
  vi.stubGlobal('window', { open: () => popup });
  printTrip(fixture());
  expect(html).toContain('<title>Weekend Cabin — Ensemble</title>');
  expect(html).toContain('ENSEMBLE · TRIP SUMMARY');
  expect(popup.print).toHaveBeenCalledOnce();
});
