/**
 * Folding and highlighting of the rows of a table shown as a tree (`level=` of the table options in src/tables.ts),
 * shared by the preview (`main.ts`) and exported HTML (`export.ts`).
 */

const TOGGLE = '.seqnotes-tree-toggle';
const FOLDED = 'seqnotes-tree-folded';
/** Class of the rows hidden under a folded row. */
export const TREE_HIDDEN = 'seqnotes-tree-hidden';
const CURRENT = 'seqnotes-tree-current';
const RELATED = 'seqnotes-tree-related';
/** Class of the body when the parents and children of the row under the pointer are highlighted (mdDesignDoc.tableTreeHighlight). */
export const TREE_HIGHLIGHT = 'seqnotes-table-tree-highlight';

const depthOf = (row: Element): number => Number(row.getAttribute('data-seqnotes-depth'));

/** The rows of the tree in a table (the body rows; also the deleted ones shown by the comparison with a revision). */
const rowsOf = (table: Element): HTMLTableRowElement[] => Array.from(table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr[data-seqnotes-depth]'));

/** Hides the rows under a folded row, keeping the rows folded inside them folded when it is unfolded. */
function updateRows(table: Element): void {
  let foldedDepth = Infinity;
  for (const row of rowsOf(table)) {
    const depth = depthOf(row);
    if (depth <= foldedDepth) {
      foldedDepth = Infinity;
    }
    const hidden = depth > foldedDepth;
    row.classList.toggle(TREE_HIDDEN, hidden);
    if (!hidden && row.classList.contains(FOLDED)) {
      foldedDepth = depth;
    }
  }
}

function setFolded(row: Element, folded: boolean): void {
  row.classList.toggle(FOLDED, folded);
  row.querySelector(TOGGLE)?.setAttribute('aria-expanded', String(!folded));
}

/** The ancestors and descendants of a row. */
function relatives(row: HTMLTableRowElement): HTMLTableRowElement[] {
  const table = row.closest('table');
  if (!table) {
    return [];
  }
  const rows = rowsOf(table);
  const index = rows.indexOf(row);
  const depth = depthOf(row);
  const related: HTMLTableRowElement[] = [];
  for (let i = index + 1; i < rows.length && depthOf(rows[i]) > depth; i++) {
    related.push(rows[i]);
  }
  let above = depth;
  for (let i = index - 1; i >= 0 && above > 0; i--) {
    if (depthOf(rows[i]) < above) {
      above = depthOf(rows[i]);
      related.push(rows[i]);
    }
  }
  return related;
}

export function setupTableTree(root: HTMLElement): void {
  // In the capture phase, so that the click on the button does not also go to the handlers of the preview
  // (e.g. a double click jumping to the editor).
  const onToggle = (e: Event): void => {
    const toggle = (e.target as Element).closest(TOGGLE);
    const row = toggle?.closest('tr');
    if (!row) {
      return;
    }
    e.stopPropagation();
    if (e.type === 'click') {
      setFolded(row, !row.classList.contains(FOLDED));
      updateRows(row.closest('table')!);
    }
  };
  root.addEventListener('click', onToggle, true);
  root.addEventListener('dblclick', onToggle, true);

  let current: HTMLTableRowElement | undefined;
  const clear = (): void => {
    root.querySelectorAll(`.${CURRENT}, .${RELATED}`).forEach((el) => el.classList.remove(CURRENT, RELATED));
    current = undefined;
  };
  root.addEventListener('mouseover', (e) => {
    const row = document.body.classList.contains(TREE_HIGHLIGHT)
      ? ((e.target as Element).closest<HTMLTableRowElement>('.seqnotes-tree-table > tbody > tr[data-seqnotes-depth]') ?? undefined)
      : undefined;
    if (row === current) {
      return;
    }
    clear();
    if (row) {
      current = row;
      row.classList.add(CURRENT);
      relatives(row).forEach((el) => el.classList.add(RELATED));
    }
  });
  root.addEventListener('mouseleave', clear);
}

/**
 * The rows of the trees in `root` with their keys: the table (among those of the document, not the deleted ones shown by
 * the comparison) and the names of the row and its ancestors, which stay the same while other rows are edited.
 */
function keyedRows(root: HTMLElement): { table: Element; row: HTMLTableRowElement; key: string }[] {
  const tables = Array.from(root.querySelectorAll('.seqnotes-tree-table')).filter((table) => !table.closest('[data-seqnotes-diff="deleted"]'));
  return tables.flatMap((table, index) => {
    const path: string[] = [];
    return rowsOf(table).map((row) => {
      const depth = depthOf(row);
      path.length = depth;
      path.push(nameOf(row));
      return { table, row, key: [index, ...path].join('\n') };
    });
  });
}

/** The text of the tree cell of a row, without the words deleted from it (marked by the comparison). */
function nameOf(row: Element): string {
  const cell = row.querySelector('.seqnotes-tree-cell')?.cloneNode(true) as Element | undefined;
  cell?.querySelectorAll('del').forEach((el) => el.remove());
  return cell?.textContent?.trim() ?? '';
}

/** Keys of the folded rows in `root`, to fold them again after its content is replaced (`restoreFolded`). */
export function foldedRows(root: HTMLElement): Set<string> {
  return new Set(keyedRows(root).flatMap(({ row, key }) => (row.classList.contains(FOLDED) ? [key] : [])));
}

export function restoreFolded(root: HTMLElement, keys: Set<string>): void {
  if (keys.size === 0) {
    return;
  }
  const changed = new Set<Element>();
  for (const { table, row, key } of keyedRows(root)) {
    if (row.classList.contains('seqnotes-tree-parent') && keys.has(key)) {
      setFolded(row, true);
      changed.add(table);
    }
  }
  changed.forEach(updateRows);
}
