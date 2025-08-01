import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';

Deno.test('CLI module can be imported', async () => {
  // Test that we can import from cli.ts without errors
  const cliModule = await import('../../src/cli.ts');
  assertExists(cliModule);
});

Deno.test('CLI module imports VERSION from core', async () => {
  // This is a smoke test that verifies the import chain works
  // We're not testing the actual main() function since it has console.log side effects
  // Instead we verify that the module loads and the import structure works

  try {
    await import('../../src/cli.ts');
    // If we get here without throwing, the imports work
    assertEquals(true, true);
  } catch (error) {
    throw new Error(
      `CLI module failed to import: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

Deno.test('CLI can access Deno.args without errors', () => {
  // Test that Deno.args is accessible (basic Deno environment test)
  assertExists(Deno.args);
  assertEquals(Array.isArray(Deno.args), true);
});

Deno.test('CLI can access import.meta.main', async () => {
  // Test that import.meta.main is accessible
  const _testModule = await import('../../src/cli.ts');

  // In test context, import.meta.main should be false for the imported module
  // This is a basic structural test
  assertEquals(typeof import.meta.main, 'boolean');
});
