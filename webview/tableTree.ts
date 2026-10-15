/**
 * Folding and highlighting of the rows of a table shown as a tree (`level=` of the table options in src/tables.ts),
 * shared by the preview (`main.ts`) and exported HTML (`export.ts`).
 */

const TOGGLE = '.seqnotes-tree-toggle';
const FOLDED = 'seqnotes-tree-folded';
const HIDDEN = 'seqnotes-tree-hidden';
const CURRENT = 'seqnotes-tree-current';
const RELATED = 'seqnotes-tree-related';

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
    row.classList.toggle(HIDDEN, hidden);
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
    const row = (e.target as Element).closest<HTMLTableRowElement>('.seqnotes-tree-table > tbody > tr[data-seqnotes-depth]');
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

/** Keys of the folded rows in `root`, to fold them again after its content is replaced (`restoreFolded`). */
export function foldedRows(root: HTMLElement): Set<string> {
  const keys = new Set<string>();
  root.querySelectorAll('.seqnotes-tree-table').forEach((table, index) => {
    for (const row of rowsOf(table)) {
      if (row.classList.contains(FOLDED)) {
        keys.add(rowKey(index, row));
      }
    }
  });
  return keys;
}

export function restoreFolded(root: HTMLElement, keys: Set<string>): void {
  if (keys.size === 0) {
    return;
  }
  root.querySelectorAll('.seqnotes-tree-table').forEach((table, index) => {
    let changed = false;
    for (const row of rowsOf(table)) {
      if (row.classList.contains('seqnotes-tree-parent') && keys.has(rowKey(index, row))) {
        setFolded(row, true);
        changed = true;
      }
    }
    if (changed) {
      updateRows(table);
    }
  });
}

/** A row is told by its table and its text in the tree column, which stay the same while other rows are edited. */
const rowKey = (table: number, row: Element): string => `${table}\n${row.querySelector('.seqnotes-tree-cell')?.textContent ?? ''}`;
