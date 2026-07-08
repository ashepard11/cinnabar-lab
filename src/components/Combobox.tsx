import { useEffect, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  id: string;
  label: string;
}

/**
 * Minimal search-filterable combobox (no component library in this codebase;
 * see DECISIONS.md D26). Type to filter, click or Enter to select; the parent
 * owns the selected set and passes only unselected options in.
 */
export default function Combobox({
  options,
  placeholder,
  disabled,
  onSelect,
}: {
  options: ComboboxOption[];
  placeholder: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
      : options;
    return matches.slice(0, 12);
  }, [options, query]);

  useEffect(() => setHighlight(0), [query, open]);

  // close on outside click
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const select = (id: string) => {
    onSelect(id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="combobox" ref={rootRef}>
      <input
        type="text"
        className="combobox-input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered[highlight]) select(filtered[highlight].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && !disabled && filtered.length > 0 && (
        <ul className="combobox-list" role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === highlight}
              className={`combobox-option${i === highlight ? ' highlighted' : ''}`}
              // mousedown, not click: fires before the input's blur
              onMouseDown={(e) => {
                e.preventDefault();
                select(o.id);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
      {open && !disabled && filtered.length === 0 && (
        <ul className="combobox-list">
          <li className="combobox-empty">no matches</li>
        </ul>
      )}
    </div>
  );
}
