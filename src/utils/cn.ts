/**
 * @file utils/cn.ts
 * @description CSS class name merger utility.
 *
 * Noledge uses vanilla CSS with CSS Custom Properties for styling, not
 * Tailwind. However, component code still needs to conditionally join
 * CSS class names from multiple sources (static classes, dynamic conditional
 * classes, and props-based overrides).
 *
 * This utility replaces the `clsx` + `twMerge` pattern from Tailwind projects.
 * It's a simple implementation without Tailwind's conflict-resolution logic,
 * since we're using a single global CSS file with BEM-like naming and custom
 * properties — class conflicts don't occur the same way.
 *
 * Usage:
 *   cn('card', isActive && 'card--active', className)
 *   // → 'card card--active user-passed-class'
 *
 *   cn('btn', variant === 'ghost' && 'btn--ghost', !disabled && 'btn--interactive')
 *   // → 'btn btn--ghost btn--interactive' (when not disabled)
 */

/**
 * cn — merge class names, filtering out falsy values.
 *
 * Accepts any number of arguments. Each argument can be:
 *   - A string: included as-is
 *   - undefined / null / false: silently skipped
 *   - A number: converted to string (edge case; prefer strings)
 *
 * Returns a single space-joined string. Leading/trailing whitespace from
 * individual class names is trimmed to prevent double-spaces.
 *
 * @param classes - Any mix of strings, falsy values, or numbers
 * @returns A single space-separated class name string, or empty string
 */
export function cn(...classes: (string | undefined | null | false | number)[]): string {
  return classes
    .filter(Boolean)                          // Remove all falsy values
    .map((c) => String(c).trim())             // Ensure strings, trim whitespace
    .filter((c) => c.length > 0)             // Remove empty strings after trim
    .join(' ');                               // Join with single space
}
