import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectDocuments, indexPath, isInFolder, outputPath, parseCommandLine, splitFill, UsageError } from '../src/cliOptions';

const cwd = join(tmpdir(), 'work');

describe('parseCommandLine capture', () => {
  it('uses the defaults', () => {
    expect(parseCommandLine(['capture', 'http://localhost:3000/signin', '-o', 'screens/signin.html'], cwd)).toEqual({
      command: 'capture',
      url: 'http://localhost:3000/signin',
      out: join(cwd, 'screens/signin.html'),
      width: 1280,
      height: 800,
      colorScheme: 'light',
      storageState: undefined,
      script: undefined,
      actions: [],
      waitFor: undefined,
      wait: undefined,
      chrome: undefined,
    });
  });

  it('reads the options, and the actions in their order', () => {
    expect(
      parseCommandLine(
        ['capture', 'https://example.com/', '--out', 'a.html', '--width', '375', '--height', '667', '--color-scheme', 'dark', '--storage-state', 'state.json', '--script', 'steps.mjs', '--click', '#open', '--fill', 'input[name=email]=a=b@example.com', '--hover', '.menu', '--fill', '#code=', '--press', 'Enter', '--wait-for', '.error', '--wait', '500', '--chrome', 'chromium'],
        cwd,
      ),
    ).toEqual({
      command: 'capture',
      url: 'https://example.com/',
      out: join(cwd, 'a.html'),
      width: 375,
      height: 667,
      colorScheme: 'dark',
      storageState: join(cwd, 'state.json'),
      script: join(cwd, 'steps.mjs'),
      actions: [
        { action: 'click', selector: '#open' },
        { action: 'fill', selector: 'input[name=email]', text: 'a=b@example.com' },
        { action: 'hover', selector: '.menu' },
        { action: 'fill', selector: '#code', text: '' },
        { action: 'press', key: 'Enter' },
      ],
      waitFor: '.error',
      wait: 500,
      chrome: 'chromium',
    });
  });

  it('splits --fill at the first = outside brackets and quotes', () => {
    expect(splitFill(`input[value="a]=b"]=y`)).toEqual({ selector: `input[value="a]=b"]`, text: 'y' });
    expect(splitFill(':is([a=b])=c')).toEqual({ selector: ':is([a=b])', text: 'c' });
    expect(splitFill('#email')).toBeUndefined();
    expect(splitFill('=x')).toBeUndefined();
  });

  it.each([
    [['capture']],
    [['capture', 'http://a', 'http://b', '-o', 'a.html']],
    [['capture', 'localhost:3000', '-o', 'a.html']],
    [['capture', 'http://a']],
    [['capture', 'http://a', '-o', 'a.html', '--width', '0']],
    [['capture', 'http://a', '-o', 'a.html', '--height', '1.5']],
    [['capture', 'http://a', '-o', 'a.html', '--wait', '-1']],
    [['capture', 'http://a', '-o', 'a.html', '--color-scheme', 'blue']],
    [['capture', 'http://a', '-o', 'a.html', '--fill', '#email']],
    [['capture', 'http://a', '-o', 'a.html', '--strict']],
  ])('rejects %j', (args) => {
    expect(() => parseCommandLine(args, cwd)).toThrow(UsageError);
  });
});

describe('parseCommandLine', () => {
  it('uses the defaults of the settings', () => {
    expect(parseCommandLine(['export', 'docs', 'a.md'], cwd)).toEqual({
      command: 'export',
      inputs: [join(cwd, 'docs'), join(cwd, 'a.md')],
      outDir: undefined,
      root: cwd,
      lang: 'en',
      diagramLook: 'neo',
      headingNumbers: true,
      frontMatter: true,
      settings: { limitContentWidth: true, stickyTableHeader: true, tableTreeHighlight: true, splitMinWidth: 1000, toc: true },
      chrome: undefined,
      strict: false,
      index: false,
      indexTitle: undefined,
      indexDesignDocs: false,
    });
  });

  it('reads the options', () => {
    expect(
      parseCommandLine(
        ['export', 'a.md', '-o', 'out', '--root', 'docs', '--lang', 'ja', '--diagram-look', 'classic', '--split-min-width', '800', '--full-width', '--no-heading-numbers', '--no-front-matter', '--no-sticky-table-header', '--no-table-tree-highlight', '--no-toc', '--chrome', './chrome', '--strict', '--index', '--index-title', 'Docs', '--index-design-docs'],
        cwd,
      ),
    ).toEqual({
      command: 'export',
      inputs: [join(cwd, 'a.md')],
      outDir: join(cwd, 'out'),
      root: join(cwd, 'docs'),
      lang: 'ja',
      diagramLook: 'classic',
      headingNumbers: false,
      frontMatter: false,
      settings: { limitContentWidth: false, stickyTableHeader: false, tableTreeHighlight: false, splitMinWidth: 800, toc: false },
      chrome: join(cwd, 'chrome'),
      strict: true,
      index: true,
      indexTitle: 'Docs',
      indexDesignDocs: true,
    });
  });

  it('reads the revision to compare with', () => {
    expect(parseCommandLine(['export', 'a.md', '--diff-base', 'v1.0'], cwd)).toMatchObject({ diffBase: 'v1.0' });
    expect(parseCommandLine(['export', 'a.md'], cwd)).toMatchObject({ diffBase: undefined });
  });

  it('keeps a command name given to --chrome', () => {
    expect(parseCommandLine(['export', 'a.md', '--chrome', 'google-chrome'], cwd)).toMatchObject({ chrome: 'google-chrome' });
  });

  it('shows the help and the version', () => {
    expect(parseCommandLine(['--help'], cwd)).toEqual({ command: 'help' });
    expect(parseCommandLine(['export', '-v'], cwd)).toEqual({ command: 'version' });
  });

  it.each([
    [[]],
    [['convert', 'a.md']],
    [['export']],
    [['export', 'a.md', '--unknown']],
    [['export', 'a.md', '--diagram-look', 'flat']],
    [['export', 'a.md', '--split-min-width', 'wide']],
    [['export', 'a.md', '--index']],
    [['export', 'a.md', '-o', 'out', '--index-title', 'Docs']],
    [['export', 'a.md', '-o', 'out', '--index-design-docs']],
    [['export', 'a.md', '--diff-base', ' ']],
  ])('rejects %j', (args) => {
    expect(() => parseCommandLine(args, cwd)).toThrow(UsageError);
  });
});

describe('collectDocuments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdai-cli-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ['b.md', 'a.markdown', 'notes.txt', 'sub/c.MD', 'node_modules/x.md', '.git/y.md']) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), '');
  }

  it('finds the Markdown files of the folders, and takes the files given as they are', () => {
    expect(collectDocuments([dir, join(dir, 'notes.txt'), join(dir, 'b.md')])).toEqual([
      join(dir, 'a.markdown'),
      join(dir, 'b.md'),
      join(dir, 'sub/c.MD'),
      join(dir, 'notes.txt'),
    ]);
  });

  it('follows symbolic links, without searching a folder twice', () => {
    const linked = mkdtempSync(join(tmpdir(), 'mdai-cli-links-'));
    try {
      writeFileSync(join(linked, 'a.md'), '');
      mkdirSync(join(linked, 'docs'));
      symlinkSync(join(linked, 'a.md'), join(linked, 'docs/link.md'));
      symlinkSync(linked, join(linked, 'docs/loop'));
      symlinkSync(join(linked, 'missing.md'), join(linked, 'docs/broken.md'));
      expect(collectDocuments([join(linked, 'docs')])).toEqual([join(linked, 'docs/link.md'), join(linked, 'docs/loop/a.md')]);
    } finally {
      rmSync(linked, { recursive: true, force: true });
    }
  });

  it('rejects a missing file', () => {
    expect(() => collectDocuments([join(dir, 'missing.md')])).toThrow(UsageError);
  });
});

describe('outputPath', () => {
  const root = join(cwd, 'repo');

  it('writes next to the document by default', () => {
    expect(outputPath(join(root, 'docs/login.md'), undefined, root)).toBe(join(root, 'docs/login.html'));
  });

  it('keeps the folders under the root in the output folder', () => {
    expect(outputPath(join(root, 'docs/api/login.md'), join(cwd, 'out'), root)).toBe(join(cwd, 'out/docs/api/login.html'));
    expect(outputPath(join(cwd, 'other/login.md'), join(cwd, 'out'), root)).toBe(join(cwd, 'out/login.html'));
  });
});

describe('indexPath', () => {
  it('writes index.html in the output folder', () => {
    expect(indexPath(join(cwd, 'out'))).toBe(join(cwd, 'out/index.html'));
  });
});

describe('isInFolder', () => {
  it('compares whole folder names', () => {
    expect(isInFolder(join(cwd, 'a/b.png'), join(cwd, 'a'))).toBe(true);
    expect(isInFolder(join(cwd, 'a'), join(cwd, 'a'))).toBe(true);
    expect(isInFolder(join(cwd, 'ab/b.png'), join(cwd, 'a'))).toBe(false);
    expect(isInFolder(join(cwd, 'b.png'), join(cwd, 'a'))).toBe(false);
    expect(isInFolder(join(cwd, '..x/b.png'), cwd)).toBe(true);
  });
});
