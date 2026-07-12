// src/utils/cx.ts

/**
 * A utility to filter out falsy values and join class names into a clean string.
 * This satisfies the layout constraints inside your copy-pasted components.
 */
export function cx(...inputs: unknown[]) {
  return inputs.filter(Boolean).join(" ");
}