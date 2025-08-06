// Cross-platform path module import
const path =
  typeof Deno !== 'undefined' ? await import('jsr:@std/path') : await import('node:path');

export interface ToolContext {
  repoRoot: string;
  toolTimeout: number;
}

/**
 * Detect if we're running on Windows platform
 * @returns true if running on Windows, false otherwise
 */
function isWindows(): boolean {
  return typeof Deno !== 'undefined' ? Deno.build.os === 'windows' : process.platform === 'win32';
}

/**
 * Securely sanitize a user-provided path to prevent path traversal attacks.
 * @param userPath - The path provided by the user
 * @param baseDir - The base directory to constrain paths to
 * @returns The sanitized relative path, or null if the path is invalid/unsafe
 */
function sanitizePath(userPath: string, baseDir: string): string | null {
  try {
    const normalizedInput = userPath.replace(/\\/g, '/'); // Normalize backslashes

    // Reject absolute paths (/path) and UNC paths (//server/share)
    if (normalizedInput.startsWith('/')) {
      return null;
    }

    // Reject Windows drive letters (C:\path)
    if (/^[a-zA-Z]:/.test(normalizedInput)) {
      return null;
    }

    // Use normalized input for path resolution to ensure proper handling
    const resolvedPath = path.resolve(baseDir, normalizedInput);

    // Normalize base directory to handle any '..' or '.' segments
    const normalizedBase = path.normalize(path.resolve(baseDir));

    // Security check: ensure resolved path is within base directory
    // Handle different separator APIs: Deno uses SEPARATOR, Node.js uses sep
    const sep = typeof Deno !== 'undefined' ? (path as any).SEPARATOR : (path as any).sep;
    if (!resolvedPath.startsWith(normalizedBase + sep) && resolvedPath !== normalizedBase) {
      return null; // Path traversal attempt detected
    }

    return path.relative(baseDir, resolvedPath);
  } catch {
    return null;
  }
}

async function runCommand(command: string[], cwd: string, timeoutMs: number): Promise<string> {
  if (!command[0]) {
    return 'Error: Empty command';
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (typeof Deno !== 'undefined') {
      // Deno environment
      const cmd = new Deno.Command(command[0], {
        args: command.slice(1),
        cwd,
        signal: controller.signal,
        stdout: 'piped',
        stderr: 'piped',
      });

      const process = cmd.spawn();
      const { code, stdout, stderr } = await process.output();

      if (code !== 0) {
        const errorMsg = new TextDecoder().decode(stderr);
        return `Error: Command failed: ${errorMsg.trim()}`;
      }

      return new TextDecoder().decode(stdout);
    } else {
      // Node.js environment (VSCode extension)
      const { spawn } = await import('child_process');

      return new Promise<string>((resolve) => {
        const process = spawn(command[0]!, command.slice(1), {
          cwd,
          signal: controller.signal as any,
        });

        let stdout = '';
        let stderr = '';

        process.stdout?.on('data', (data: any) => {
          stdout += data.toString();
        });

        process.stderr?.on('data', (data: any) => {
          stderr += data.toString();
        });

        process.on('close', (code: number | null) => {
          if (code !== 0) {
            resolve(`Error: Command failed: ${stderr.trim()}`);
          } else {
            resolve(stdout);
          }
        });

        process.on('error', (error: Error) => {
          resolve(`Error: ${error.message}`);
        });
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return `Error: Command timed out after ${timeoutMs}ms`;
    }
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function readFile(filePath: string, context: ToolContext): Promise<string> {
  console.log(`🔧 readFile: Called with filePath='${filePath}', repoRoot='${context.repoRoot}'`);

  const sanitizedPath = sanitizePath(filePath, context.repoRoot);
  if (sanitizedPath === null) {
    return `Error: Invalid file path '${filePath}' - path traversal detected or path outside repository`;
  }

  const fullPath = path.resolve(context.repoRoot, sanitizedPath);
  console.log(`🔧 readFile: Resolved fullPath='${fullPath}'`);

  try {
    if (typeof Deno !== 'undefined') {
      try {
        const content = await Deno.readTextFile(fullPath);
        console.log(
          `🔧 readFile: Successfully read ${content.length} characters from '${fullPath}'`
        );
        return content;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return `Error: File not found: ${sanitizedPath}`;
        }
        return `Error: Cannot read file '${sanitizedPath}': ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      const fs = await import('fs/promises');
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        return content;
      } catch (error: unknown) {
        const nodeError = error as { code?: string; message?: string };
        if (nodeError.code === 'ENOENT') {
          return `Error: File not found: ${sanitizedPath}`;
        }
        if (nodeError.code === 'EISDIR') {
          return `Error: Path '${sanitizedPath}' is a directory, not a file`;
        }
        return `Error: Cannot read file '${sanitizedPath}': ${nodeError.message || String(error)}`;
      }
    }
  } catch (error) {
    return `Error: Cannot read file '${sanitizedPath}': ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function listDirectory(directoryPath: string, context: ToolContext): Promise<string> {
  const sanitizedPath = sanitizePath(directoryPath, context.repoRoot);
  if (sanitizedPath === null) {
    return `Error: Invalid directory path '${directoryPath}' - path traversal detected or path outside repository`;
  }

  const fullPath = path.resolve(context.repoRoot, sanitizedPath);

  const command = isWindows() ? ['cmd', '/c', `dir "${fullPath}"`] : ['ls', '-la', fullPath];

  const result = await runCommand(command, context.repoRoot, context.toolTimeout);

  if (result.startsWith('Error:')) {
    return `Error: Cannot list directory '${sanitizedPath}': ${result.slice(7)}`;
  }

  return result;
}

export async function findFiles(pattern: string, context: ToolContext): Promise<string> {
  console.log(
    `🔧 findFiles: Searching for pattern '${pattern}' in repo root '${context.repoRoot}'`
  );

  // Use git ls-files which respects .gitignore
  // -c shows cached/tracked files, -o shows others/untracked files
  // --exclude-standard respects .gitignore and other exclusion files
  const command = ['git', 'ls-files', '-c', '-o', '--exclude-standard', '--', pattern];

  const result = await runCommand(command, context.repoRoot, context.toolTimeout);

  if (result.startsWith('Error:')) {
    return `Error: Cannot find files matching '${pattern}': ${result.slice(7)}`;
  }

  // Git ls-files already returns paths relative to repo root
  // Just filter out empty lines
  const relativePaths = result
    .split('\n')
    .filter((line) => line.trim())
    .join('\n');

  console.log(`🔧 findFiles: Found ${relativePaths.split('\n').filter((p) => p).length} files`);
  return relativePaths;
}

export async function searchContent(query: string, context: ToolContext): Promise<string> {
  console.log(`🔧 searchContent: Searching for '${query}' in repo root '${context.repoRoot}'`);

  const command = [
    'rg',
    '--max-count',
    '50',
    '--line-number',
    '--with-filename',
    '--color',
    'never',
    query,
    '.', // Search current directory (which will be context.repoRoot due to cwd)
  ];

  const result = await runCommand(command, context.repoRoot, context.toolTimeout);

  if (result.startsWith('Error:')) {
    return `Error: Cannot search content for '${query}': ${result.slice(7)}`;
  }

  // Convert paths to be relative to repo root for better LLM understanding
  const relativeResults = result
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      // Remove leading './' if present (from ripgrep)
      return line.startsWith('./') ? line.slice(2) : line;
    })
    .join('\n');

  console.log(`🔧 searchContent: Found ${relativeResults.split('\n').length} results`);
  return relativeResults;
}

// Legacy tools export - using the old format that works
export const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read complete file content as string',
      parameters: {
        type: 'object' as const,
        properties: {
          file_path: {
            type: 'string' as const,
            description: 'Path to the file to read',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List directory contents using system ls/dir command',
      parameters: {
        type: 'object' as const,
        properties: {
          directory_path: {
            type: 'string' as const,
            description: 'Path to the directory to list',
          },
        },
        required: ['directory_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_files',
      description: 'Find files matching pattern using system find/dir command',
      parameters: {
        type: 'object' as const,
        properties: {
          pattern: {
            type: 'string' as const,
            description: 'File pattern to search for (e.g., "*.ts", "README*")',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_content',
      description: 'Search repository content using ripgrep',
      parameters: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string' as const,
            description: 'Text pattern to search for in file contents',
          },
        },
        required: ['query'],
      },
    },
  },
];
