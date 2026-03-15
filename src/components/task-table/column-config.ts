export type ColumnKey =
  | 'issue'
  | 'pr'
  | 'status'
  | 'amount'
  | 'assigned'
  | 'payment'
  | 'note';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  locked?: boolean; // Can't be hidden
}

export const BUILT_IN_COLUMNS: ColumnDef[] = [
  { key: 'issue', label: 'Issue', locked: true },
  { key: 'pr', label: 'PR' },
  { key: 'status', label: 'Status' },
  { key: 'amount', label: 'Amount' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'payment', label: 'Payment' },
  { key: 'note', label: 'Note' },
];

export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  key: ColumnKey | 'created_at' | 'updated_at';
  direction: SortDirection;
}

const VISIBILITY_KEY = 'tasker-visible-columns';
const ORDER_KEY = 'tasker-column-order';
const SORT_KEY = 'tasker-sort-config';

const DEFAULT_ORDER: ColumnKey[] = [
  'issue',
  'pr',
  'status',
  'amount',
  'assigned',
  'payment',
  'note',
];

export function loadVisibleColumns(): Set<ColumnKey> {
  if (typeof window === 'undefined') return new Set(DEFAULT_ORDER);
  try {
    const stored = localStorage.getItem(VISIBILITY_KEY);
    if (stored) {
      const keys = JSON.parse(stored) as ColumnKey[];
      const set = new Set(keys);
      for (const col of BUILT_IN_COLUMNS) {
        if (col.locked) set.add(col.key);
      }
      return set;
    }
  } catch {}
  return new Set(DEFAULT_ORDER);
}

export function saveVisibleColumns(columns: Set<ColumnKey>): void {
  try {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify([...columns]));
  } catch {}
}

export function loadColumnOrder(): ColumnKey[] {
  if (typeof window === 'undefined') return DEFAULT_ORDER;
  try {
    const stored = localStorage.getItem(ORDER_KEY);
    if (stored) {
      const order = JSON.parse(stored) as ColumnKey[];
      // Ensure all columns are present (in case new ones were added)
      for (const col of DEFAULT_ORDER) {
        if (!order.includes(col)) order.push(col);
      }
      return order;
    }
  } catch {}
  return DEFAULT_ORDER;
}

export function saveColumnOrder(order: ColumnKey[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {}
}

// Filters
export interface TaskFilters {
  statuses: string[]; // status keys
}

const FILTERS_KEY = 'tasker-filters';

const EMPTY_FILTERS: TaskFilters = { statuses: [] };

export function loadFilters(): TaskFilters {
  if (typeof window === 'undefined') return EMPTY_FILTERS;
  try {
    const stored = localStorage.getItem(FILTERS_KEY);
    if (stored) return { ...EMPTY_FILTERS, ...JSON.parse(stored) };
  } catch {}
  return EMPTY_FILTERS;
}

export function saveFilters(filters: TaskFilters): void {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {}
}

const DEFAULT_SORT: SortConfig = { key: 'created_at', direction: 'desc' };

export function loadSortConfig(): SortConfig {
  if (typeof window === 'undefined') return DEFAULT_SORT;
  try {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored) return JSON.parse(stored) as SortConfig;
  } catch {}
  return DEFAULT_SORT;
}

export function saveSortConfig(config: SortConfig): void {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(config));
  } catch {}
}
