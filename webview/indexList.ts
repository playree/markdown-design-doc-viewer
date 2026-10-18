/**
 * The search box and the sortable columns of a list of documents (`indexBody` in src/exportIndex.ts), in the preview
 * (the list of the design documents of VS Code and the desktop app) and in an exported index.html.
 */
import type { IndexListState } from '../src/protocol';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The words of the search, without case. */
function words(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Adds the search box under the title of the list `index` (`.seqnotes-index`), and makes its column headers sort
 * the rows of each table. Starts from `state`, and gives the new one to `onChange`. Returns the search box (none
 * without documents).
 */
export function setUpIndexList(index: HTMLElement, state: IndexListState = { query: '' }, onChange?: (state: IndexListState) => void): HTMLInputElement | undefined {
  const tables = Array.from(index.querySelectorAll<HTMLTableElement>(':scope > table'));
  if (tables.length === 0) {
    return undefined;
  }
  const text = (key: string): string => index.getAttribute(`data-seqnotes-${key}`) ?? '';
  let current: IndexListState = { ...state };
  /** The rows in the order of the list, for the order without sorting. */
  const original = new Map(tables.map((table) => [table, Array.from(table.tBodies[0]?.rows ?? [])]));
  const total = [...original.values()].reduce((sum, rows) => sum + rows.length, 0);

  const bar = document.createElement('div');
  bar.className = 'seqnotes-index-filter';
  const input = document.createElement('input');
  input.type = 'search';
  input.value = current.query;
  input.placeholder = text('filter-placeholder');
  input.setAttribute('aria-label', text('filter-label'));
  const count = document.createElement('span');
  count.className = 'seqnotes-index-count';
  count.setAttribute('aria-live', 'polite');
  bar.append(input, count);
  const noMatch = document.createElement('p');
  noMatch.className = 'seqnotes-index-empty';
  noMatch.textContent = text('no-match');
  index.querySelector(':scope > h1')?.after(bar);
  tables[tables.length - 1].after(noMatch);

  const buttons: HTMLButtonElement[][] = tables.map((table) =>
    Array.from(table.tHead?.rows[0]?.cells ?? [], (th) => {
      const column = th.dataset.seqnotesColumn ?? '';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seqnotes-index-sort';
      button.title = text('sort-title');
      button.append(...Array.from(th.childNodes));
      button.addEventListener('click', () => {
        const sort = current.sort;
        // Ascending, descending, then the order of the list.
        current = {
          ...current,
          sort: sort?.column !== column ? { column, descending: false } : sort.descending ? undefined : { column, descending: true },
        };
        apply();
        onChange?.(current);
      });
      th.replaceChildren(button);
      return button;
    }),
  );

  input.addEventListener('input', () => {
    current = { ...current, query: input.value };
    apply();
    onChange?.(current);
  });

  function apply(): void {
    const filter = words(current.query);
    const sort = current.sort;
    let shown = 0;
    tables.forEach((table, i) => {
      const rows = [...original.get(table)!];
      // The columns of all the tables are the same. A column gone (no document has that entry any longer) sorts nothing.
      const column = sort ? buttons[i].findIndex((button) => button.parentElement!.dataset.seqnotesColumn === sort.column) : -1;
      if (sort && column >= 0) {
        // A cell may give the value it is sorted by (e.g. the number of changes).
        const key = (row: HTMLTableRowElement): string => {
          const cell = row.cells[column];
          return cell?.dataset.seqnotesSort ?? cell?.textContent?.trim() ?? '';
        };
        rows.sort((a, b) => {
          const [x, y] = [key(a), key(b)];
          // The rows without the value last, in both orders.
          return x === '' || y === '' ? Number(x === '') - Number(y === '') : collator.compare(x, y) * (sort.descending ? -1 : 1);
        });
      }
      let visible = 0;
      for (const row of rows) {
        const haystack = (row.textContent ?? '').toLocaleLowerCase();
        row.hidden = !filter.every((word) => haystack.includes(word));
        visible += row.hidden ? 0 : 1;
      }
      table.tBodies[0]?.append(...rows);
      table.hidden = visible === 0;
      // The heading of the folder.
      const heading = table.previousElementSibling;
      if (heading?.tagName === 'H2') {
        (heading as HTMLElement).hidden = visible === 0;
      }
      buttons[i].forEach((button) => {
        const th = button.parentElement!;
        if (sort && sort.column === th.dataset.seqnotesColumn) {
          th.setAttribute('aria-sort', sort.descending ? 'descending' : 'ascending');
        } else {
          th.removeAttribute('aria-sort');
        }
      });
      shown += visible;
    });
    count.textContent = text('count').replace('{0}', String(shown)).replace('{1}', String(total));
    noMatch.hidden = shown > 0;
  }

  apply();
  return input;
}
