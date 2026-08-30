'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sounds } from '@/lib/sounds';
import { useSettingsStore } from '@/stores/settingsStore';
import { cn } from '@/utils/cn';
import styles from './CustomSelect.module.css';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface CustomSelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  'aria-label'?: string;
  className?: string;
}

export default function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  className,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { sound_enabled } = useSettingsStore();

  const selectedOption = options.find((opt) => String(opt.value) === String(value)) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sound_enabled && !isOpen) sounds.playTick();
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (val: T, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sound_enabled) sounds.playToggle();
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={cn(styles.selectWrapper, className)}>
      <button
        type="button"
        className={cn(styles.trigger, isOpen && styles.triggerOpen)}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className={styles.label}>{selectedOption?.label}</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={cn(styles.chevron, isOpen && styles.chevronOpen)}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="custom-select-dropdown"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={styles.dropdown}
            role="listbox"
          >
            <div className={styles.dropdownInner}>
              {options.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(styles.option, isSelected && styles.optionSelected)}
                    onClick={(e) => handleSelect(opt.value, e)}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check size={14} strokeWidth={2.5} className={styles.checkIcon} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
