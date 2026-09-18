'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import styles from './CustomSelect.module.css';

export interface CustomSelectOption {
  value: string;
  label: string;
  badge?: string;
}

export interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  searchable?: boolean;
  alignRight?: boolean;
  isOrbVariant?: boolean;
  className?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  searchable = false,
  alignRight = false,
  isOrbVariant = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Filter options if searchable
  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        (opt.badge && opt.badge.toLowerCase().includes(q))
    );
  }, [options, search, searchable]);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  return (
    <div
      ref={containerRef}
      className={`${styles.customSelectContainer} ${isOpen ? styles.open : ''} ${
        isOrbVariant ? styles.orbVariantStyle : ''
      } ${className}`}
    >
      <button
        type="button"
        className={styles.customSelectTrigger}
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setSearch('');
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={styles.customSelectTriggerText}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className={styles.customSelectTriggerArrow}>
          <ChevronDown size={11} strokeWidth={2.5} />
        </span>
      </button>

      {isOpen && (
        <div
          className={`${styles.customSelectDropdown} ${
            alignRight ? styles.alignRight : ''
          }`}
          role="listbox"
        >
          {searchable && (
            <div className={styles.customSelectSearchWrap}>
              <Search size={12} strokeWidth={2.5} className={styles.customSelectSearchIcon} />
              <input
                type="text"
                className={styles.customSelectSearchInput}
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className={styles.customSelectOptions}>
            {filteredOptions.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  className={`${styles.customSelectOption} ${
                    isSelected ? styles.selected : ''
                  }`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className={styles.customOptionLabel}>{opt.label}</span>
                  {opt.badge && <span className={styles.shaderOptBadge}>{opt.badge}</span>}
                  {isSelected && (
                    <Check size={12} strokeWidth={3} className={styles.customOptionCheck} />
                  )}
                </div>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className={styles.customSelectEmpty}>No matches found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
