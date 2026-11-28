import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const CODEX_DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024;

describe('the instructions for AI agents', () => {
  it('fit in the default Codex limit before project trust is configured', () => {
    expect(Buffer.byteLength(read('AGENTS.md'))).toBeLessThanOrEqual(CODEX_DEFAULT_PROJECT_DOC_MAX_BYTES);
  });

  it('use CLAUDE.md solely to import AGENTS.md', () => {
    expect(read('CLAUDE.md').trimEnd()).toBe('@AGENTS.md');
  });
});
