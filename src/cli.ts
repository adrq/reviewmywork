import { VERSION } from '@/core/version.ts';
import { validateGitRepo, getGitDiff } from '@/core/git.ts';
import { loadCLISettings } from '@/core/config.ts';
import { ReviewOrchestrator } from '@/core/reviewer.ts';
import { VercelLLMProvider } from '@/core/vercel-llm-provider.ts';

interface CLIArgs {
  repoPath: string;
  base?: string;
  help?: boolean;
  version?: boolean;
}

function parseArgs(args: string[]): CLIArgs {
  console.log(`🔍 parseArgs: Input args:`, args);
  
  const result: CLIArgs = {
    repoPath: '.',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    console.log(`🔍 parseArgs: Processing arg[${i}] = '${arg}'`);

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      console.log(`🔍 parseArgs: Set help = true`);
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
      console.log(`🔍 parseArgs: Set version = true`);
    } else if (arg === '--base' || arg === '-b') {
      const baseValue = args[++i];
      result.base = baseValue || '';
      console.log(`🔍 parseArgs: Set base = '${result.base}', advanced i to ${i}`);
    } else if (arg && !arg.startsWith('-')) {
      // Positional argument - repo path
      result.repoPath = arg;
      console.log(`🔍 parseArgs: Set repoPath = '${result.repoPath}'`);
    }
  }

  console.log(`🔍 parseArgs: Final result:`, result);
  return result;
}

function showHelp() {
  console.log(`ReviewMyWork v${VERSION} - AI Code Review Agent

USAGE:
    reviewmywork review [repo_path] --base <commit>

ARGUMENTS:
    [repo_path]    Path to git repository (default: current directory)

OPTIONS:
    -b, --base <commit>    Base branch/commit to compare against working directory
    -h, --help            Show this help message
    -v, --version         Show version information

EXAMPLES:
    reviewmywork review --base main
    reviewmywork review . --base develop
    reviewmywork review /path/to/repo --base HEAD~1

CONFIGURATION:
    Set these environment variables:
    REVIEWMYWORK_PROVIDER=azure|openai|anthropic
    REVIEWMYWORK_MODEL=gpt-4
    AZURE_OPENAI_API_KEY=your-key  (or OPENAI_API_KEY, ANTHROPIC_API_KEY)`);
}

function showVersion() {
  console.log(`ReviewMyWork v${VERSION}`);
}

async function runReview(repoPath: string, base: string) {
  try {
    // Load configuration
    const settings = loadCLISettings();

    if (!settings.provider || !settings.model) {
      console.error(
        '❌ Missing configuration. Please set REVIEWMYWORK_PROVIDER and REVIEWMYWORK_MODEL environment variables.'
      );
      Deno.exit(1);
    }

    if (!settings.apiKey) {
      console.error(
        '❌ Missing API key. Please set AZURE_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY environment variable.'
      );
      Deno.exit(1);
    }

    console.log(`🚀 ReviewMyWork v${VERSION} • ${settings.provider}:${settings.model}`);

    // Validate git repository
    console.log('📁 Validating git repository...');
    await validateGitRepo(repoPath);

    // Get git diff
    console.log(`🔍 Analyzing changes from ${base} to working directory`);
    const diffContent = await getGitDiff(repoPath, base);
    
    // Debug: Show diff info
    console.log(`📊 Diff length: ${diffContent.length} characters`);
    if (diffContent.length === 0) {
      console.log(`⚠️  Warning: No changes detected between ${base} and working directory`);
    }

    if (!diffContent.trim()) {
      console.log(
        `📝 No changes found in working directory compared to ${base}. Nothing to review.`
      );
      return;
    }

    // Run review
    console.log('🤖 Performing AI code review...');
    const provider = new VercelLLMProvider(settings);
    const orchestrator = new ReviewOrchestrator(provider, repoPath, settings);
    const review = await orchestrator.review(diffContent);

    // Display results
    console.log('\n📋 Review Results:');
    console.log('==================');
    console.log(`\nSummary: ${review.summary}`);
    console.log(`Confidence: ${(review.confidence * 100).toFixed(1)}%`);

    if (review.issues && review.issues.length > 0) {
      console.log('\n🚨 Issues Found:');
      review.issues.forEach((issue, i) => {
        console.log(`${i + 1}. [${issue.severity.toUpperCase()}] ${issue.title}`);
        console.log(`   File: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
        console.log(`   ${issue.description}`);
        if (issue.suggestion) {
          console.log(`   💡 ${issue.suggestion}`);
        }
        console.log('');
      });
    }

    if (review.positive_aspects && review.positive_aspects.length > 0) {
      console.log('✅ Positive Aspects:');
      review.positive_aspects.forEach((aspect: any) => {
        console.log(`• ${aspect.title}: ${aspect.description}`);
      });
      console.log('');
    }

    if (review.suggestions && review.suggestions.length > 0) {
      console.log('💡 Suggestions:');
      review.suggestions.forEach((suggestion) => {
        console.log(`• [${suggestion.priority}] ${suggestion.title}: ${suggestion.description}`);
      });
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    Deno.exit(1);
  }
}

async function main() {
  console.log(`🔍 main: Raw Deno.args:`, Deno.args);
  const args = parseArgs(Deno.args);

  if (args.help) {
    showHelp();
    return;
  }

  if (args.version) {
    showVersion();
    return;
  }

  // Default command is review
  if (!args.base) {
    console.error('❌ Missing required argument: --base <commit>');
    console.log('\nUse --help for usage information.');
    Deno.exit(1);
  }

  await runReview(args.repoPath, args.base);
}

if (import.meta.main) {
  main();
}
