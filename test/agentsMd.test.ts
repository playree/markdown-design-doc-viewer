import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Room for the global instructions (~/.codex/AGENTS.md), which count towards the same limit of Codex. */
const GLOBAL_INSTRUCTIONS_ROOM = 8 * 1024;

describe('the instructions for AI agents', () => {
  it('fit in the limit of Codex in .codex/config.toml (raise project_doc_max_bytes if AGENTS.md grew)', () => {
    const limit = Number(/^project_doc_max_bytes\s*=\s*(\d+)\s*$/m.exec(read('.codex/config.toml'))?.[1]);
    expect(limit).toBeGreaterThan(0);
    expect(Buffer.byteLength(read('AGENTS.md'))).toBeLessThanOrEqual(limit - GLOBAL_INSTRUCTIONS_ROOM);
  });

  it('are imported into CLAUDE.md for Claude Code', () => {
    expect(read('CLAUDE.md')).toMatch(/^@AGENTS\.md$/m);
  });
});
