#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

async function buildExtension() {
  console.log('🔨 Building VSCode extension...');

  // Use existing npm script
  const cmd = new Deno.Command('npm', {
    args: ['run', 'compile'],
  });
  const result = await cmd.output();

  if (result.success) {
    console.log('✅ Extension built successfully');
    console.log('   📁 out/extension.js');
  } else {
    console.error('❌ Extension build failed');
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await buildExtension();
}
