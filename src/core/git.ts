/**
 * Simple git operations for extracting diffs
 * Matches Python version functionality exactly
 */

/**
 * Check if a directory is a git repository
 */
export async function validateGitRepo(repoPath: string): Promise<void> {
  try {
    const gitDir = await Deno.stat(`${repoPath}/.git`);
    if (!gitDir.isDirectory && !gitDir.isFile) {
      throw new Error(`${repoPath} is not a git repository`);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${repoPath} is not a git repository`);
    }
    throw error;
  }
}

/**
 * Get git diff between base commit and working directory
 * Matches Python: repo.git.diff(base, unified=3)
 */
export async function getGitDiff(repoPath: string, base: string): Promise<string> {
  const command = new Deno.Command('git', {
    args: ['diff', base, '--unified=3'],
    cwd: repoPath,
    stdout: 'piped',
    stderr: 'piped',
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`Failed to get git diff: ${errorText.trim()}`);
  }

  const diffContent = new TextDecoder().decode(stdout);
  return diffContent;
}
