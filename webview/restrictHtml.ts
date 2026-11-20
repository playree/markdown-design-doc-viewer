/**
 * The raw HTML of a document restricted to what does not reach the page around the viewer (`restrictHtml` of the
 * embedded viewer, embed/viewer.ts): without the elements that style or navigate the page (<style>, <link>, <form>,
 * <area>…), the form controls other than those of the renderer, the styles and classes other than those of the
 * renderer, and the attributes that point to the elements of the page (`for`, `usemap`…). The light DOM of an embedded
 * viewer is part of the page of the app: the global styles of the app (e.g. a `fixed inset-0` of Tailwind CSS) apply to
 * its classes and ids, and its ids are among those of the app (`getElementById`).
 *
 * The checks are pure functions of the attributes, tested by test/restrictHtml.test.ts. Nothing here touches the DOM
 * before it is called (the module may be imported on a server).
 */
import DOMPurify from 'dompurify';
import { HEADING_ID_PREFIX } from '../src/shared/slug';

/** The elements removed, besides those DOMPurify removes by default. */
export const RESTRICTED_FORBID_TAGS = ['style', 'link', 'meta', 'base', 'form', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'map', 'area', 'dialog'];

/**
 * The attributes removed: what shows an element over the page (`popover`), takes the focus of the page (`autofocus`,
 * `tabindex`), or points to an element of the page by its id or name (`for` of a <label> clicks it).
 */
export const RESTRICTED_FORBID_ATTR = ['popover', 'popovertarget', 'popovertargetaction', 'autofocus', 'tabindex', 'for', 'usemap', 'form', 'name'];

/** A declaration of a `style` kept: the alignment of a table cell, and the depth of a row of a table tree (src/markdown/tables.ts). */
const TEXT_ALIGN_RE = /^text-align\s*:\s*(left|center|right)$/i;
const DEPTH_RE = /^--seqnotes-depth\s*:\s*(\d{1,3})$/;

/** The declarations of `style` that the renderer writes, in their order, or '' without any. */
export function restrictStyle(style: string): string {
  const kept: string[] = [];
  for (const declaration of style.split(';')) {
    const text = declaration.trim();
    const align = TEXT_ALIGN_RE.exec(text);
    const depth = DEPTH_RE.exec(text);
    if (align) {
      kept.push(`text-align:${align[1].toLowerCase()}`);
    } else if (depth) {
      kept.push(`--seqnotes-depth:${depth[1]}`);
    }
  }
  return kept.join(';');
}

/**
 * The classes of the renderer (src/markdown/, src/diff/, src/export/): the viewer's own, those of markdown-it (task lists,
 * footnotes, the language of a code block), GitHub alerts and their icons, and highlight.js (`hljs-title class_`).
 */
const ALLOWED_CLASS_RE =
  /^(?:seqnotes-[\w-]+|task-list-item(?:-checkbox)?|contains-task-list|markdown-alert(?:-[\w-]+)?|octicon(?:-[\w-]+)?|footnotes?(?:-[\w-]+)?|hljs(?:-[\w-]+)?|language-\S+|[a-z]+_+)$/;

/**
 * The classes of the viewer that the renderer does not write: those of its element and of what it shows over the page
 * (`position: fixed` in preview.css), which an element of the document would be shown as.
 */
const OVERLAY_CLASS_RE = /^seqnotes-(?:viewer|embedded|zoom|toc|diff-bar|footnote-popup|mermaid-scratch)(?:-|$)/;

/** The classes of `value` that the renderer writes, in their order, or '' without any. */
export function restrictClass(value: string): string {
  return value
    .split(/\s+/)
    .filter((name) => ALLOWED_CLASS_RE.test(name) && !OVERLAY_CLASS_RE.test(name))
    .join(' ');
}

/** The ids of the footnotes of markdown-it-footnote (`fn1`, `fnref1`, `fnref1:2`). */
const FOOTNOTE_ID_RE = /^(?:fn\d+|fnref\d+(?::\d+)?)$/;

/**
 * The id of an element of the document: those of the renderer (headings, footnotes) as they are, the others with the
 * prefix of the headings (`HEADING_ID_PREFIX`), so that they are not those of the page. A `#fragment` link still finds
 * them (`scrollToFragment` tries the prefix).
 */
export function restrictId(id: string): string {
  return id.startsWith(HEADING_ID_PREFIX) || FOOTNOTE_ID_RE.test(id) ? id : HEADING_ID_PREFIX + id;
}

/** The attributes that refer to elements by a list of their ids. */
export const ID_LIST_ATTRS = [
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-details',
  'aria-errormessage',
  'aria-flowto',
  'aria-labelledby',
  'aria-owns',
  'headers',
];

/** The attributes of SVG that refer to elements by `url(#id)`. */
export const URL_REF_ATTRS = ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end'];

/** A list of ids (`ID_LIST_ATTRS`), with the ids restricted as those of the elements (`restrictId`). */
export function restrictIdList(value: string): string {
  return value
    .split(/\s+/)
    .filter((id) => id !== '')
    .map(restrictId)
    .join(' ');
}

/** The `url(#id)`s of a value (`URL_REF_ATTRS`), with the ids restricted as those of the elements (`restrictId`). */
export function restrictUrlRefs(value: string): string {
  return value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (_match, quote: string, id: string) => `url(${quote}#${restrictId(id)}${quote})`);
}

/** An `href` of SVG (`<use href="#id">`), with its id restricted as those of the elements (`restrictId`). */
export function restrictHrefRef(value: string): string {
  return value.startsWith('#') && value.length > 1 ? `#${restrictId(value.slice(1))}` : value;
}

/** The attributes of a form control that tell whether it is the renderer's. */
export interface ControlAttributes {
  type?: string | null;
  className?: string | null;
  disabled?: boolean;
}

const hasClass = (className: string | null | undefined, name: string): boolean => (className ?? '').split(/\s+/).includes(name);

/**
 * true for a form control that the renderer writes: the checkbox of a task list (src/markdown/markdownExtras.ts), and the
 * buttons of a table (src/markdown/tables.ts). Its other controls, those of the raw HTML, are removed.
 */
export function allowedControl(tag: string, { type, className, disabled = false }: ControlAttributes): boolean {
  switch (tag.toLowerCase()) {
    case 'input':
      return type?.toLowerCase() === 'checkbox' && disabled && hasClass(className, 'task-list-item-checkbox');
    case 'button':
      return type?.toLowerCase() === 'button' && (hasClass(className, 'seqnotes-table-plain-toggle') || hasClass(className, 'seqnotes-tree-toggle'));
    default:
      return true;
  }
}

/** Sanitizes `html` as the preview does (`sanitize` in preview.ts), with the restrictions above. */
export function sanitizeRestricted(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: RESTRICTED_FORBID_TAGS,
    FORBID_ATTR: RESTRICTED_FORBID_ATTR,
  });
  for (const control of Array.from(fragment.querySelectorAll('input, button'))) {
    const allowed = allowedControl(control.localName, {
      type: control.getAttribute('type'),
      className: control.getAttribute('class'),
      disabled: control.hasAttribute('disabled'),
    });
    if (!allowed) {
      // Replaced by its content: the text of a button is kept, as DOMPurify keeps that of the elements it removes.
      control.replaceWith(...Array.from(control.childNodes));
    }
  }
  restrictAttribute(fragment, 'style', restrictStyle);
  restrictAttribute(fragment, 'class', restrictClass);
  restrictAttribute(fragment, 'id', restrictId);
  // What refers to the ids, which keep referring to the same elements (and not to those of the page). The links (`<a>`,
  // `<area>`) find them with the prefix (`scrollToFragment`), as those of the headings: their `#fragment` is kept.
  for (const name of ID_LIST_ATTRS) {
    restrictAttribute(fragment, name, restrictIdList);
  }
  for (const name of URL_REF_ATTRS) {
    restrictAttribute(fragment, name, restrictUrlRefs);
  }
  for (const element of Array.from(fragment.querySelectorAll('svg [href], svg [*|href]'))) {
    for (const attr of Array.from(element.attributes)) {
      if (attr.localName === 'href') {
        attr.value = restrictHrefRef(attr.value);
      }
    }
  }
  return fragment;
}

/** Rewrites the attribute `name` of the elements of `fragment` with `restrict`, or removes it when nothing is left. */
function restrictAttribute(fragment: DocumentFragment, name: string, restrict: (value: string) => string): void {
  for (const element of Array.from(fragment.querySelectorAll(`[${name}]`))) {
    const value = restrict(element.getAttribute(name) ?? '');
    if (value) {
      element.setAttribute(name, value);
    } else {
      element.removeAttribute(name);
    }
  }
}
