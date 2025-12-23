import pc from "picocolors";

// Semantic color functions for consistent usage across the codebase
export const colors = {
  // Status indicators
  success: (text: string) => pc.green(text),
  error: (text: string) => pc.red(text),
  warning: (text: string) => pc.yellow(text),
  info: (text: string) => pc.cyan(text),

  // Secondary/dim text for paths, SHAs, etc.
  dim: (text: string) => pc.dim(text),

  // Bold for emphasis
  bold: (text: string) => pc.bold(text),

  // Severity colors for security advisories
  critical: (text: string) => pc.red(pc.bold(text)),
  high: (text: string) => pc.red(text),
  moderate: (text: string) => pc.yellow(pc.bold(text)),
  low: (text: string) => pc.yellow(text),
} as const;
