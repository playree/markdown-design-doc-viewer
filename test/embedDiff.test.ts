import { describe, expect, it } from 'vitest';
import { viewerContent } from '../embed/viewer';
import { formatMessage } from '../src/shared/l10n';

const env = { t: formatMessage };

const before = `# Login

The user signs in with a password.

## Steps

Removed paragraph.
`;

const after = `# Login

The user signs in with a passkey.

## Steps

Added paragraph.

Another added paragraph.
`;

describe('viewerContent', () => {
  it('renders the document alone without a version to compare with', () => {
    const { html, diff } = viewerContent(after, env);
    expect(diff).toBeUndefined();
    expect(html).not.toContain('data-seqnotes-diff');
    expect(html).toContain('passkey');
  });

  it('renders the differences from the version to compare with', () => {
    const { html, diff } = viewerContent(after, env, before, 'Version 3');
    expect(diff?.label).toBe('Version 3');
    expect(diff?.stats.changed).toBeGreaterThan(0);
    expect(diff?.stats.added).toBeGreaterThan(0);
    expect(html).toContain('data-seqnotes-diff="changed"');
    expect(html).toContain('data-seqnotes-diff="added"');
    // The changed block is shown with the words of the version it is compared with.
    expect(diff?.old.some((block) => block.includes('password'))).toBe(true);
  });

  it('has an empty label without one', () => {
    expect(viewerContent(after, env, before).diff?.label).toBe('');
  });

  it('shows no changes when the versions are the same', () => {
    const { html, diff } = viewerContent(after, env, after);
    expect(diff?.stats).toEqual({ added: 0, changed: 0, deleted: 0 });
    expect(html).not.toContain('data-seqnotes-diff=');
  });
});
