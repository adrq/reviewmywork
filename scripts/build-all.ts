#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

async function buildAll() {
  console.log('🏗️ Building all targets...');

  // Build CLI first
  console.log('\n1️⃣ Building CLI...');
  const cliCmd = new Deno.Command('deno', {
    args: ['run', '--allow-read', '--allow-write', '--allow-run', 'scripts/build-cli.ts'],
  });
  const cliResult = await cliCmd.output();

  if (!cliResult.success) {
    console.error('❌ CLI build failed');
    Deno.exit(1);
  }

  // Build extension second
  console.log('\n2️⃣ Building Extension...');
  const extCmd = new Deno.Command('deno', {
    args: ['run', '--allow-read', '--allow-write', '--allow-run', 'scripts/build-extension.ts'],
  });
  const extResult = await extCmd.output();

  if (!extResult.success) {
    console.error('❌ Extension build failed');
    Deno.exit(1);
  }

  console.log('\n🎉 All builds completed!');
  console.log('📁 CLI: dist/bin/reviewmywork, dist/bin/rmw');
  console.log('📁 Extension: out/extension.js');
}

if (import.meta.main) {
  await buildAll();
}
