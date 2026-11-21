import { describe, expect, it } from 'vitest';
import { allowedControl, RESTRICTED_FORBID_ATTR, RESTRICTED_FORBID_TAGS, restrictClass, restrictHrefRef, restrictId, restrictIdList, restrictStyle, restrictUrlRefs } from '../webview/restrictHtml';

describe('restrictStyle', () => {
  it.each([
    ['text-align:left', 'text-align:left'],
    ['text-align: center', 'text-align:center'],
    ['TEXT-ALIGN:Right;', 'text-align:right'],
    // A tree cell of a table (src/markdown/tables.ts).
    ['text-align:center;--seqnotes-depth:2', 'text-align:center;--seqnotes-depth:2'],
    ['--seqnotes-depth:0', '--seqnotes-depth:0'],
  ])('keeps the declarations of the renderer: %s', (style, expected) => {
    expect(restrictStyle(style)).toBe(expected);
  });

  it.each([
    ['position:fixed;inset:0;z-index:9999', ''],
    ['text-align:left;position:fixed', 'text-align:left'],
    ['color:red; text-align:right', 'text-align:right'],
    ['text-align:justify', ''],
    ['text-align:left !important', ''],
    ['text-align:left /* ; */', ''],
    ['--seqnotes-depth:1;--seqnotes-split:90%', '--seqnotes-depth:1'],
    ['--seqnotes-depth:calc(1e9)', ''],
    ['background:url(https://example.com/a.png)', ''],
    ['', ''],
  ])('removes the others: %s', (style, expected) => {
    expect(restrictStyle(style)).toBe(expected);
  });
});

describe('restrictClass', () => {
  it.each([
    'seqnotes-pair',
    'seqnotes-tree-toggle',
    'seqnotes-diff-block',
    'task-list-item',
    'task-list-item-checkbox',
    'contains-task-list',
    'markdown-alert markdown-alert-note',
    'markdown-alert-title',
    'octicon octicon-info',
    'footnote-ref',
    'footnotes',
    'footnotes-sep',
    'footnote-backref',
    'hljs-title class_',
    'hljs-title function_ invoke__',
    'language-ts',
    'language-c++',
  ])('keeps the classes of the renderer: %s', (value) => {
    expect(restrictClass(value)).toBe(value);
  });

  it.each([
    // Of the app around the viewer (Tailwind CSS).
    ['fixed inset-0 z-50 bg-white', ''],
    ['hidden', ''],
    // Of what the viewer shows over the page.
    ['seqnotes-zoom', ''],
    ['seqnotes-zoom-stage', ''],
    ['seqnotes-toc', ''],
    ['seqnotes-diff-bar', ''],
    ['seqnotes-footnote-popup', ''],
    ['seqnotes-mermaid-scratch', ''],
    ['seqnotes-viewer seqnotes-embedded', ''],
    ['seqnotes-viewer-root', ''],
    ['seqnotes-pair fixed seqnotes-toc', 'seqnotes-pair'],
    ['  seqnotes-pair   seqnotes-seq-col ', 'seqnotes-pair seqnotes-seq-col'],
  ])('removes the others: %s', (value, expected) => {
    expect(restrictClass(value)).toBe(expected);
  });

  it('keeps the classes of the renderer that start like those of the overlays', () => {
    expect(restrictClass('seqnotes-diff-block seqnotes-diff-counts')).toBe('seqnotes-diff-block seqnotes-diff-counts');
  });
});

describe('restrictId', () => {
  it.each(['sn-login', 'sn-1-sign-in', 'fn1', 'fnref12', 'fnref1:2'])('keeps the ids of the renderer: %s', (id) => {
    expect(restrictId(id)).toBe(id);
  });

  it.each([
    ['modal-root', 'sn-modal-root'],
    ['app', 'sn-app'],
    ['fn', 'sn-fn'],
    ['fnref1x', 'sn-fnref1x'],
  ])('gives the others the prefix of the headings: %s', (id, expected) => {
    expect(restrictId(id)).toBe(expected);
  });
});

describe('references to ids', () => {
  it('restricts a list of ids as the ids of the elements', () => {
    expect(restrictIdList('caption  sn-title fn1')).toBe('sn-caption sn-title fn1');
    expect(restrictIdList('  ')).toBe('');
  });

  it.each([
    ['url(#gradient)', 'url(#sn-gradient)'],
    ['url("#gradient")', 'url("#sn-gradient")'],
    ["url( '#sn-a' )", "url('#sn-a')"],
    ['none', 'none'],
    ['url(https://example.com/a.svg#x)', 'url(https://example.com/a.svg#x)'],
    ['URL(#Gradient)', 'url(#sn-Gradient)'],
    ['Url("#gradient")', 'url("#sn-gradient")'],
  ])('restricts the ids of url(#id): %s', (value, expected) => {
    expect(restrictUrlRefs(value)).toBe(expected);
  });

  it.each([
    ['#icon', '#sn-icon'],
    ['#sn-icon', '#sn-icon'],
    ['#', '#'],
    ['icons.svg#icon', 'icons.svg#icon'],
  ])('restricts the id of an href of SVG: %s', (value, expected) => {
    expect(restrictHrefRef(value)).toBe(expected);
  });
});

describe('allowedControl', () => {
  it('keeps the checkbox of a task list (src/markdown/markdownExtras.ts)', () => {
    expect(allowedControl('input', { type: 'checkbox', className: 'task-list-item-checkbox', disabled: true })).toBe(true);
  });

  it.each([
    [{ type: 'checkbox', className: 'task-list-item-checkbox', disabled: false }],
    [{ type: 'checkbox', className: null, disabled: true }],
    [{ type: 'text', className: 'task-list-item-checkbox', disabled: true }],
    [{ type: 'submit', className: 'task-list-item-checkbox', disabled: true }],
    [{ type: 'image', disabled: false }],
    [{}],
  ])('removes the other inputs: %o', (attrs) => {
    expect(allowedControl('input', attrs)).toBe(false);
  });

  it.each(['seqnotes-table-plain-toggle', 'seqnotes-tree-toggle'])('keeps the button of a table: %s', (className) => {
    expect(allowedControl('button', { type: 'button', className })).toBe(true);
    expect(allowedControl('BUTTON', { type: 'BUTTON', className: `${className} extra` })).toBe(true);
  });

  it.each([
    [{ type: 'submit', className: 'seqnotes-tree-toggle' }],
    [{ type: null, className: 'seqnotes-tree-toggle' }],
    [{ type: 'button', className: 'seqnotes-tree-toggle-x' }],
    [{ type: 'button', className: 'fixed inset-0' }],
  ])('removes the other buttons: %o', (attrs) => {
    expect(allowedControl('button', attrs)).toBe(false);
  });

  it('leaves the other elements to the sanitizer', () => {
    expect(allowedControl('div', {})).toBe(true);
  });
});

describe('RESTRICTED_FORBID_TAGS', () => {
  it('has the elements that style or navigate the page', () => {
    expect(RESTRICTED_FORBID_TAGS).toEqual(expect.arrayContaining(['style', 'link', 'meta', 'base', 'form', 'textarea', 'select', 'map', 'area', 'dialog']));
  });
});

describe('RESTRICTED_FORBID_ATTR', () => {
  it('has the attributes that reach the elements or the focus of the page', () => {
    expect(RESTRICTED_FORBID_ATTR).toEqual(expect.arrayContaining(['popover', 'popovertarget', 'autofocus', 'tabindex', 'for', 'usemap', 'form', 'name']));
  });
});
