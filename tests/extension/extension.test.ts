import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';

// Note: These tests focus on business logic and structure that doesn't require VSCode APIs
// Full extension integration tests require VSCode environment via Remote-SSH

Deno.test('Extension module structure', async () => {
  // Test that the extension module can be imported and has expected exports
  // This will fail if there are import issues with the VERSION constant

  try {
    // We can't actually import the extension module in Deno because it has vscode dependency
    // But we can test that the core business logic (VERSION) is importable
    const { VERSION } = await import('../../src/core/version.ts');
    assertExists(VERSION);
    assertEquals(typeof VERSION, 'string');
  } catch (error) {
    throw new Error(
      `Extension dependency chain failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

Deno.test('Extension can access shared VERSION constant', async () => {
  // Test that the VERSION import chain works for extension
  // This verifies the import mapping works correctly

  const { VERSION } = await import('../../src/core/version.ts');
  assertExists(VERSION);

  // Verify it's the expected format
  const semverPattern = /^\d+\.\d+\.\d+$/;
  assertEquals(semverPattern.test(VERSION), true);
});

Deno.test('Extension module file exists and is readable', async () => {
  // Basic file system test to ensure extension.ts is present and readable
  try {
    const extensionFile = await Deno.readTextFile('src/extension.ts');
    assertEquals(extensionFile.includes('export function activate'), true);
    assertEquals(extensionFile.includes('export function deactivate'), true);
    assertEquals(extensionFile.includes('import'), true);
  } catch (error) {
    throw new Error(
      `Extension source file not accessible: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
});

// Note: Full extension tests with VSCode API mocking would go here in future phases
// For MVP, we focus on import chain validation and file structure verification
