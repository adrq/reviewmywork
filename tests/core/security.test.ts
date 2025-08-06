import { assertEquals } from 'jsr:@std/assert';
import { readFile, listDirectory } from '../../src/core/tools.ts';

const mockContext = {
  repoRoot: '/safe/repo',
  toolTimeout: 5000,
};

Deno.test('Security - Path traversal prevention in readFile', async () => {
  const maliciousPaths = [
    '/etc/passwd',
    '../../../etc/passwd',
    '..\\..\\..\\Windows\\System32\\config\\SAM',
    'C:\\Windows\\System32\\config\\SAM',
    '\\\\server\\share\\secret.txt',
    '/home/user/.ssh/id_rsa',
    '../../../home/user/.ssh/id_rsa',
  ];

  for (const maliciousPath of maliciousPaths) {
    const result = await readFile(maliciousPath, mockContext);
    assertEquals(
      result.startsWith('Error: Invalid file path'),
      true,
      `Should reject malicious path: ${maliciousPath}`
    );
  }
});

Deno.test('Security - Path traversal prevention in listDirectory', async () => {
  const maliciousPaths = [
    '/etc',
    '../../../etc',
    '..\\..\\..\\Windows\\System32',
    'C:\\Windows\\System32',
    '\\\\server\\share',
  ];

  for (const maliciousPath of maliciousPaths) {
    const result = await listDirectory(maliciousPath, mockContext);
    assertEquals(
      result.startsWith('Error: Invalid directory path'),
      true,
      `Should reject malicious path: ${maliciousPath}`
    );
  }
});

Deno.test('Security - Allow legitimate relative paths', async () => {
  // These should be allowed (though they may fail for other reasons like file not found)
  const legitimatePaths = [
    'src/main.ts',
    'docs/README.md',
    './src/utils.ts',
    'src/../src/main.ts', // Should normalize to src/main.ts
    '.',
    '', // Root of repo
  ];

  for (const legitimatePath of legitimatePaths) {
    const result = await readFile(legitimatePath, mockContext);
    assertEquals(
      result.startsWith('Error: Invalid file path'),
      false,
      `Should allow legitimate path: ${legitimatePath}, got: ${result}`
    );
  }
});
