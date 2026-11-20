/**
 * The raw HTML of a document restricted to what does not reach the page around the viewer (`restrictHtml` of the
 * embedded viewer, embed/viewer.ts): without the elements that style or navigate the page (<style>, <link>, <form>,
 * <area>…), the form controls other than those of the renderer, and the styles and classes other than those of the
 * renderer. The light DOM of an embedded viewer is part of the page of the app: the global styles of the app (e.g. a
 * `fixed inset-0` of Tailwind CSS) apply to its classes.
 *
 * The checks are pure functions of the attributes, tested by test/restrictHtml.test.ts. Nothing here touches the DOM
 * before it is called (the module may be imported on a server).
 */
import DOMPurify from 'dompurify';

/** The elements removed, besides those DOMPurify removes by default. */
export const RESTRICTED_FORBID_TAGS = ['style', 'link', 'meta', 'base', 'form', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'map', 'area', 'dialog'];

/** The attributes removed: what shows an element over the page (`popover`) or takes the focus of the page. */
export const RESTRICTED_FORBID_ATTR = ['popover', 'popovertarget', 'popovertargetaction', 'autofocus'];

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
