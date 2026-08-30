"use client";

import React from "react";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (checked: boolean) => void;
  label?: string;
  labelSide?: "left" | "right";
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  id?: string;
  className?: string;
  "aria-label"?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  onChange,
  label,
  labelSide = "right",
  disabled = false,
  size = "md",
  id,
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const handleToggle = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (disabled) return;
    const next = !checked;
    onCheckedChange?.(next);
    onChange?.(next);
  };

  const isSmall = size === "sm";
  const trackWidth = isSmall ? 36 : 46;
  const trackHeight = isSmall ? 20 : 26;
  const thumbSize = isSmall ? 16 : 22;
  const thumbOffset = isSmall ? 16 : 20;

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "12px",
        flexDirection: labelSide === "left" ? "row-reverse" : "row",
        userSelect: "none",
      }}
    >
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-label={ariaLabel || label}
        disabled={disabled}
        onClick={handleToggle}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          width: `${trackWidth}px`,
          height: `${trackHeight}px`,
          borderRadius: "9999px",
          padding: "2px",
          border: "none",
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          backgroundColor: checked ? "#10b981" : "#334155",
          transition: "background-color 0.2s ease, box-shadow 0.2s ease",
          boxShadow: checked
            ? "0 4px 14px -2px rgba(16, 185, 129, 0.55)"
            : "inset 0 1px 2px rgba(0, 0, 0, 0.25)",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${thumbSize}px`,
            height: `${thumbSize}px`,
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15)",
            pointerEvents: "none",
            transform: checked ? `translateX(${thumbOffset}px)` : "translateX(0px)",
            transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </button>

      {label && (
        <span
          onClick={handleToggle}
          style={{
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: "14px",
            fontWeight: 500,
            color: "var(--color-text-primary, #1e293b)",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
