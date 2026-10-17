/**
 * The page of the settings of the desktop app (View > Settings...): a modal dialog over the preview, whose changes
 * apply at once. The settings are kept by the app (host.ts).
 */
import type { Translate } from '../src/l10n';
import type { DiagramLook, PreviewTheme } from '../src/protocol';
import { DEFAULT_SETTINGS, isWidth, type DesktopSettings } from './settings';

export interface SettingsDialogOptions {
  t: Translate;
  /** The themes, with their texts (not translated), in the order of View > Theme. */
  themes: readonly (readonly [PreviewTheme, string])[];
  /** The settings in use, kept by the app. */
  settings: () => DesktopSettings;
  /** The theme in use. */
  theme: () => PreviewTheme;
  /** The settings changed. */
  onChange: (settings: DesktopSettings) => void;
  /** The theme changed. */
  onThemeChange: (theme: PreviewTheme) => void;
}

export interface SettingsDialog {
  /** Opens the dialog with the settings and the theme in use. */
  open(): void;
  /** Shows the settings and the theme changed elsewhere (in another window, or View > Theme), if it is open. */
  update(): void;
}

/** The settings shown with a check box, with their texts (not translated). */
const FLAGS: [keyof DesktopSettings, string, string][] = [
  ['toc', 'Table of Contents', 'Shown when hovering the right edge of the preview.'],
  ['headingNumbers', 'Heading Numbers', "With autonumber, the arrow's number at the start of its linked heading."],
  ['frontMatter', 'Front Matter', 'Shows the front matter as a table, or as a header with type: design_doc.'],
  ['limitContentWidth', 'Limit Text Width', 'Keeps the text in a centered column up to 1280px wide.'],
  ['stickyTableHeader', 'Sticky Table Headers', 'Keeps the header row of a long table at the top while scrolling through it.'],
  ['tableTreeHighlight', 'Highlight Table Trees', 'In a table shown as a tree, highlights the parents and children of the row under the pointer.'],
];

const LOOKS: DiagramLook[] = ['neo', 'classic'];

let nextId = 0;

/** Adds the dialog to the page, closed until `open`. */
export function createSettingsDialog({ t, themes, settings, theme, onChange, onThemeChange }: SettingsDialogOptions): SettingsDialog {
  const dialog = document.createElement('dialog');
  dialog.className = 'desktop-settings';
  const form = document.createElement('form');
  form.method = 'dialog';
  const heading = document.createElement('h2');
  heading.id = `desktop-settings-title-${++nextId}`;
  heading.textContent = t('Settings');
  dialog.setAttribute('aria-labelledby', heading.id);
  const list = document.createElement('div');
  list.className = 'desktop-settings-list';

  /** A row of the list: a control, labeled with `text` and described with `note`. */
  function row(control: HTMLElement, text: string, note: string, check = false): void {
    const id = `desktop-settings-${++nextId}`;
    control.id = id;
    const element = document.createElement('div');
    element.className = check ? 'desktop-settings-row desktop-settings-check' : 'desktop-settings-row';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = t(text);
    const description = document.createElement('p');
    description.id = `${id}-note`;
    description.className = 'desktop-settings-note';
    description.textContent = t(note);
    control.setAttribute('aria-describedby', description.id);
    if (check) {
      element.append(control, label, description);
    } else {
      element.append(label, control, description);
    }
    list.append(element);
  }

  function select<T extends string>(options: readonly (readonly [T, string])[], onSelect: (value: T) => void): HTMLSelectElement {
    const element = document.createElement('select');
    for (const [value, text] of options) {
      element.append(new Option(t(text), value));
    }
    element.addEventListener('change', () => onSelect(element.value as T));
    return element;
  }

  function change(next: Partial<DesktopSettings>): void {
    onChange({ ...settings(), ...next });
  }

  const themeSelect = select(themes, onThemeChange);
  row(themeSelect, 'Theme', 'The colors of the preview. The exported HTML is always light.');
  const lookSelect = select(
    LOOKS.map((look) => [look, look] as const),
    (diagramLook) => change({ diagramLook }),
  );
  row(lookSelect, 'Diagram Look', 'neo: rounder shapes, with shadows on flowchart nodes. classic: flat, without shadows.');

  const widthInput = document.createElement('input');
  widthInput.type = 'number';
  widthInput.min = '0';
  widthInput.step = '100';
  widthInput.className = 'desktop-settings-width';
  const changeWidth = () => {
    const value = widthInput.valueAsNumber;
    if (!isWidth(value)) {
      // Not a width: the one in use is shown again.
      widthInput.value = String(settings().splitMinWidth);
      return;
    }
    const width = Math.round(value);
    widthInput.value = String(width);
    if (width !== settings().splitMinWidth) {
      change({ splitMinWidth: width });
    }
  };
  widthInput.addEventListener('change', changeWidth);
  widthInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // Applies the width without closing the dialog (the form's submission).
      e.preventDefault();
      changeWidth();
    }
  });
  row(widthInput, 'Side-by-Side Width (px)', 'Shows the diagrams beside their step descriptions when the preview is at least this wide.');

  const checks = new Map<keyof DesktopSettings, HTMLInputElement>();
  for (const [key, text, note] of FLAGS) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => change({ [key]: input.checked }));
    checks.set(key, input);
    row(input, text, note, true);
  }

  const actions = document.createElement('div');
  actions.className = 'desktop-settings-actions';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'desktop-settings-reset';
  resetButton.textContent = t('Restore Defaults');
  resetButton.addEventListener('click', () => {
    onChange({ ...DEFAULT_SETTINGS });
    onThemeChange('auto');
    show();
  });
  const closeButton = document.createElement('button');
  // Closes the dialog (`method="dialog"`).
  closeButton.type = 'submit';
  closeButton.className = 'desktop-settings-close';
  closeButton.textContent = t('Close');
  actions.append(resetButton, closeButton);

  form.append(heading, list, actions);
  dialog.append(form);
  // Not for the keys of the preview (webview/main.ts), such as those of the zoom of a diagram, or Escape that unpins
  // the highlight: Escape still closes the dialog.
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  // A width typed but not applied yet (closed with Escape while typing).
  dialog.addEventListener('close', () => {
    if (widthInput.value !== String(settings().splitMinWidth)) {
      changeWidth();
    }
  });
  document.body.append(dialog);

  /** Shows the settings and the theme in use. */
  function show(): void {
    const current = settings();
    themeSelect.value = theme();
    lookSelect.value = current.diagramLook;
    // Unless it is being typed in.
    if (document.activeElement !== widthInput) {
      widthInput.value = String(current.splitMinWidth);
    }
    for (const [key, input] of checks) {
      input.checked = current[key] === true;
    }
  }

  return {
    open() {
      show();
      if (!dialog.open) {
        dialog.showModal();
      }
    },
    update() {
      if (dialog.open) {
        show();
      }
    },
  };
}
