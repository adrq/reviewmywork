#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

async function runTests() {
  console.log('🧪 Running all tests...\n');

  let allTestsPassed = true;

  // Test 1: Run Deno tests
  console.log('1️⃣ Running Deno tests...');
  const denoTestCmd = new Deno.Command('deno', {
    args: ['test', '--allow-read', 'tests/'],
  });

  const denoResult = await denoTestCmd.output();

  if (denoResult.success) {
    console.log('✅ Deno tests passed\n');
  } else {
    console.error('❌ Deno tests failed');
    console.error(new TextDecoder().decode(denoResult.stderr));
    allTestsPassed = false;
  }

  // Test 2: Deno Type checking (CLI and shared code)
  console.log('2️⃣ Running Deno TypeScript type check...');
  const denoTypeCheckCmd = new Deno.Command('deno', {
    args: ['check', 'src/cli.ts', 'src/core/version.ts'],
  });

  const denoTypeResult = await denoTypeCheckCmd.output();

  if (denoTypeResult.success) {
    console.log('✅ Deno type check passed\n');
  } else {
    console.error('❌ Deno type check failed');
    console.error(new TextDecoder().decode(denoTypeResult.stderr));
    allTestsPassed = false;
  }

  // Test 3: Node.js Type checking (Extension code)
  console.log('3️⃣ Running Node.js TypeScript type check...');
  const nodeTypeCheckCmd = new Deno.Command('npm', {
    args: ['run', 'typecheck'],
  });

  const nodeTypeResult = await nodeTypeCheckCmd.output();

  if (nodeTypeResult.success) {
    console.log('✅ Node.js type check passed\n');
  } else {
    console.error('❌ Node.js type check failed');
    console.error(new TextDecoder().decode(nodeTypeResult.stderr));
    allTestsPassed = false;
  }

  // Test 4: ESLint (works for both CLI and extension)
  console.log('4️⃣ Running ESLint...');
  const lintCmd = new Deno.Command('npm', {
    args: ['run', 'lint'],
  });

  const lintResult = await lintCmd.output();

  if (lintResult.success) {
    console.log('✅ ESLint passed\n');
  } else {
    console.error('❌ ESLint failed');
    console.error(new TextDecoder().decode(lintResult.stderr));
    allTestsPassed = false;
  }

  // Test 5: Prettier format check
  console.log('5️⃣ Checking code formatting with Prettier...');
  const fmtCmd = new Deno.Command('npx', {
    args: ['prettier', '--check', 'src/', 'tests/', 'scripts/'],
  });

  const fmtResult = await fmtCmd.output();

  if (fmtResult.success) {
    console.log('✅ Code formatting is correct\n');
  } else {
    console.error('❌ Code formatting issues found');
    console.error(new TextDecoder().decode(fmtResult.stderr));
    console.log('💡 Run "npm run fmt" to fix formatting issues\n');
    allTestsPassed = false;
  }

  // Final report
  console.log('📊 Test Results Summary:');
  console.log('========================');

  if (allTestsPassed) {
    console.log('🎉 All tests passed!');
    console.log('✅ Ready for CI/CD pipeline');
    Deno.exit(0);
  } else {
    console.log('💥 Some tests failed!');
    console.log('❌ Please fix issues before committing');
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await runTests();
}
