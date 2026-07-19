import { type FormEvent, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from './ui';

export interface ListFilterValues {
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}

export function ListFilters({
  value,
  statusOptions = [],
  searchPlaceholder = 'Search',
  onChange,
}: {
  value: ListFilterValues;
  statusOptions?: string[];
  searchPlaceholder?: string;
  onChange(value: ListFilterValues): void;
}) {
  const [draft, setDraft] = useState(value);
  function submit(event: FormEvent) {
    event.preventDefault();
    onChange(draft);
  }
  return (
    <form className="list-filters" onSubmit={submit}>
      <label>
        <span className="sr-only">Search</span>
        <Search aria-hidden="true" />
        <input
          value={draft.search}
          placeholder={searchPlaceholder}
          onChange={(event) => setDraft({ ...draft, search: event.target.value })}
        />
      </label>
      {statusOptions.length > 0 && (
        <label>
          <span className="sr-only">Status</span>
          <select
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value })}
          >
            <option value="">All statuses</option>
            {statusOptions.map((status) => <option value={status} key={status}>{status.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
      )}
      <label><span>From</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} /></label>
      <label><span>To</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} /></label>
      <Button type="submit" variant="secondary"><SlidersHorizontal /> Apply</Button>
      {(value.search || value.status || value.dateFrom || value.dateTo) && (
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            const empty = { search: '', status: '', dateFrom: '', dateTo: '' };
            setDraft(empty);
            onChange(empty);
          }}
        >
          Clear
        </Button>
      )}
    </form>
  );
}
