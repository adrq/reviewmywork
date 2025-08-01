import { VERSION } from '@/core/version.ts';

function main() {
  console.log('🚀 ReviewMyWork CLI v' + VERSION);
  console.log('📝 TypeScript rewrite in progress...');

  if (Deno.args.length > 0) {
    console.log('📋 Arguments received:', Deno.args);
  } else {
    console.log('💡 Try: deno run src/cli.ts --help');
  }

  console.log('✅ CLI entry point working!');
}

if (import.meta.main) {
  main();
}
