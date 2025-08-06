/**
 * Version information for ReviewMyWork
 * This constant is shared between CLI and VSCode extension
 */
export const VERSION = '0.2.0';

/**
 * Build information (for future use)
 */
export const BUILD_INFO = {
  version: VERSION,
  target: typeof globalThis !== 'undefined' && 'Deno' in globalThis ? 'deno' : 'node',
  timestamp: new Date().toISOString(),
} as const;

/**
 * Runtime detection utilities
 */
export function isDeno(): boolean {
  return typeof globalThis !== 'undefined' && 'Deno' in globalThis;
}

export function isVSCode(): boolean {
  try {
    // Check if we're in Node.js environment first
    if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
      const nodeProcess = (globalThis as { process?: { env?: { VSCODE_PID?: string } } }).process;
      return nodeProcess?.env?.VSCODE_PID !== undefined;
    }
    return false;
  } catch {
    return false;
  }
}
