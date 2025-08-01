#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

async function buildCLI() {
  console.log('🔨 Building CLI executables...');

  // Create output directory
  await Deno.mkdir('dist/bin', { recursive: true });

  const permissions = ['--allow-read', '--allow-write', '--allow-run', '--allow-env'];

  // Build reviewmywork
  console.log('📦 Building reviewmywork...');
  const cmd1 = new Deno.Command('deno', {
    args: ['compile', ...permissions, '--output=dist/bin/reviewmywork', 'src/cli.ts'],
  });
  const result1 = await cmd1.output();

  if (!result1.success) {
    console.error('❌ Failed to build reviewmywork');
    Deno.exit(1);
  }

  // Build rmw (same binary, different name)
  console.log('📦 Building rmw...');
  const cmd2 = new Deno.Command('deno', {
    args: ['compile', ...permissions, '--output=dist/bin/rmw', 'src/cli.ts'],
  });
  const result2 = await cmd2.output();

  if (!result2.success) {
    console.error('❌ Failed to build rmw');
    Deno.exit(1);
  }

  console.log('✅ Both CLI executables built successfully!');
  console.log('   📁 dist/bin/reviewmywork');
  console.log('   📁 dist/bin/rmw');
}

if (import.meta.main) {
  await buildCLI();
}
