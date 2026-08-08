import { describe, expect, it, vi } from 'vitest';
import { LengthBoundsError, parseWithLengthRetry } from './length-retry.js';

describe('parseWithLengthRetry', () => {
  it('returns the first result and makes no second call when parsing succeeds', async () => {
    const call = vi.fn().mockResolvedValue({ summary: 'ok' });
    const out = await parseWithLengthRetry(call, (raw) => raw as { summary: string }, 'summary');

    expect(out).toEqual({ summary: 'ok' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('');
  });

  it('retries once with the rejection fed back when a length bound is violated', async () => {
    const call = vi.fn().mockResolvedValueOnce({ n: 2075 }).mockResolvedValueOnce({ n: 1800 });
    const parse = (raw: unknown): { n: number } => {
      const v = raw as { n: number };
      if (v.n > 2000) {
        throw new LengthBoundsError(`summary length ${v.n} out of bounds [200, 2000]`);
      }
      return v;
    };

    const out = await parseWithLengthRetry(call, parse, 'summary');

    expect(out).toEqual({ n: 1800 });
    expect(call).toHaveBeenCalledTimes(2);
    const note = call.mock.calls[1]![0] as string;
    expect(note).toContain('summary length 2075 out of bounds [200, 2000]');
    expect(note).toContain('Do not truncate mid-sentence');
  });

  it('propagates a second length violation rather than looping', async () => {
    const call = vi.fn().mockResolvedValue({ n: 2075 });
    const parse = (): never => {
      throw new LengthBoundsError('summary length 2075 out of bounds [200, 2000]');
    };

    await expect(parseWithLengthRetry(call, parse, 'summary')).rejects.toThrow(
      'summary length 2075 out of bounds',
    );
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('does not retry errors that are not length violations', async () => {
    const call = vi.fn().mockResolvedValue({});
    const parse = (): never => {
      throw new Error('missing required field');
    };

    await expect(parseWithLengthRetry(call, parse, 'summary')).rejects.toThrow(
      'missing required field',
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
});
