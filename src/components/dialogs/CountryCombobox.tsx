import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { COUNTRIES, filterCountries, getCountryName, resolveCountryCode, type CountryOption } from '../../constants/countries';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import './CountryCombobox.css';

export interface CountryComboboxProps {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  className?: string;
  error?: string;
  disabled?: boolean;
}

export const CountryCombobox = ({ value, onChange, id = 'country-combobox', className = '', error, disabled }: CountryComboboxProps) => {
  const tr = useUiTranslation();
  const [query, setQuery] = useState(() => getCountryName(value));
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastEmittedValue = useRef(value);
  const options = filtering ? filterCountries(query) : COUNTRIES;
  const activeOption = options[highlighted];
  const listId = `${id}-listbox`;

  useEffect(() => {
    // Parent updates caused by typing must not replace a partial query with ''.
    if (value !== lastEmittedValue.current) setQuery(getCountryName(value));
    lastEmittedValue.current = value;
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      const below = window.innerHeight - rect.bottom - gap - 8;
      const above = rect.top - gap - 8;
      const placeAbove = below < 220 && above > below;
      const maxHeight = Math.max(0, Math.min(220, placeAbove ? above : below));
      const width = Math.min(rect.width, window.innerWidth - 16);
      setPopupStyle({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(placeAbove ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
        maxHeight,
      });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && activeOption) document.getElementById(`${id}-option-${activeOption.code}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeOption?.code, id]);

  const emit = (code: string) => {
    lastEmittedValue.current = code;
    onChange(code);
  };
  const select = (country: CountryOption) => {
    setQuery(country.name);
    emit(country.code);
    setOpen(false);
    setFiltering(false);
  };
  const showOptions = () => {
    setFiltering(false);
    setHighlighted(Math.max(0, COUNTRIES.findIndex(country => country.code === value)));
    setOpen(true);
  };

  return (
    <div className={`rtx-country-combobox ${className}`}>
      <label id={`${id}-label`} htmlFor={id}>{tr('Country')}</label>
      <div className="rtx-country-combobox__field">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && activeOption ? `${id}-option-${activeOption.code}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          placeholder={tr('Search country')}
          value={query}
          disabled={disabled}
          onFocus={showOptions}
          onChange={event => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setFiltering(true);
            setHighlighted(0);
            setOpen(true);
            emit(resolveCountryCode(nextQuery));
          }}
          onBlur={() => {
            setOpen(false);
            const code = resolveCountryCode(query);
            if (code) setQuery(getCountryName(code));
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) { showOptions(); return; }
              setHighlighted(index => options.length
                ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                : 0);
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (activeOption) select(activeOption);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button
          className="rtx-country-combobox__toggle"
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={tr('Show countries')}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            if (open) setOpen(false);
            else { inputRef.current?.focus(); showOptions(); }
          }}
        ><ChevronDown size={16} aria-hidden="true" /></button>
      </div>
      {error && <div id={`${id}-error`} className="rtx-country-combobox__error" role="alert">{error}</div>}
      {open && createPortal(
        <div ref={listRef} id={listId} className="rtx-country-combobox__list" role="listbox" aria-labelledby={`${id}-label`} style={popupStyle}>
          {options.length ? options.map((country, index) => (
            <div
              id={`${id}-option-${country.code}`}
              key={country.code}
              role="option"
              aria-label={country.name}
              aria-selected={country.code === value}
              className={`rtx-country-combobox__option${index === highlighted ? ' is-highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={event => { event.stopPropagation(); select(country); }}
            >
              <span>{country.name}</span>
              <span className="rtx-country-combobox__code">{country.code}</span>
              {country.code === value && <Check size={14} aria-hidden="true" />}
            </div>
          )) : <div className="rtx-country-combobox__empty" role="status">{tr('No countries found')}</div>}
        </div>, document.body,
      )}
    </div>
  );
};
