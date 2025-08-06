import { LLMProvider, Message, ToolDefinition, ToolCall } from './llm-provider.ts';
import { ReviewOutput, reviewOutputSchema } from './schemas.ts';
import { tools, readFile, listDirectory, findFiles, searchContent, ToolContext } from './tools.ts';
import { Settings } from './config.ts';

/**
 * Main orchestrator for code review process
 * Handles the complete flow: diff analysis → tool calling → structured review
 */
export class ReviewOrchestrator {
  private toolContext: ToolContext;
  private settings: Settings;
  private maxTokensUsed = 0;

  constructor(
    private provider: LLMProvider,
    repoRoot: string,
    settings: Settings
  ) {
    this.toolContext = {
      repoRoot,
      toolTimeout: settings.toolTimeout,
    };
    this.settings = settings;

    // Set tool context for Vercel provider if available
    if ('setToolContext' in this.provider) {
      (this.provider as any).setToolContext(this.toolContext);
    }
  }

  /**
   * Main entry point for code review
   * @param diffContent Raw git diff content
   * @returns Structured review output
   */
  async review(diffContent: string): Promise<ReviewOutput> {
    // Phase 1: Analysis with tools (AI SDK v5 handles automatically)
    const analysisResult = await this.runAnalysisWithTools(diffContent);

    // Phase 2: Generate structured review
    const review = await this.generateStructuredReview(analysisResult);

    return review;
  }

  /**
   * Phase 1: Run analysis using manual tool calling loop for better control
   */
  private async runAnalysisWithTools(diffContent: string): Promise<string> {
    const systemPrompt = this.createSystemPrompt();
    const initialMessage = this.createDiffContext(diffContent);

    const messages: Message[] = [{ role: 'user', content: initialMessage }];
    const maxTurns = this.settings.maxTurns || 20; // Adaptive based on settings
    let totalToolCalls = 0;

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        console.log(
          `🔄 Analysis turn ${turn + 1}/${maxTurns} (${totalToolCalls} tools used so far)`
        );

        // Compress message history and track tokens
        const compressedMessages = this.compressMessageHistory(messages);

        // Estimate total tokens
        let totalTokens = this.estimateTokens(systemPrompt);
        for (const msg of compressedMessages) {
          totalTokens += this.estimateTokens(msg.content);
        }

        // Track maximum tokens used
        this.maxTokensUsed = Math.max(this.maxTokensUsed, totalTokens);

        // Log token usage
        console.log(
          `📊 Token estimate: ${totalTokens.toLocaleString()} tokens (${Math.round(totalTokens / 10000) / 100}M)`
        );
        if (totalTokens > 800000) {
          console.warn(`⚠️  Approaching token limit: ${totalTokens.toLocaleString()} / 1,000,000`);
        }

        const result = await this.makeRetryingLLMCall(async () => {
          return this.provider.generateText({
            messages: compressedMessages,
            tools: this.getToolDefinitions(),
            systemPrompt,
            temperature: 0.1,
            maxTokens: 4000,
          });
        });

        // Add assistant response to conversation
        if (result.text) {
          messages.push({ role: 'assistant', content: result.text });
          console.log(`💬 Assistant response: ${result.text.length} characters`);
        }

        // Handle tool calls if any
        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log(`🔧 Processing ${result.toolCalls.length} tool calls...`);
          totalToolCalls += result.toolCalls.length;

          // Add tool invocations to the last assistant message
          const lastMessage = messages[messages.length - 1];
          if (lastMessage) {
            lastMessage.toolInvocations = result.toolCalls.map((tc) => tc);
          }

          // Execute tools and add results as user messages (simpler approach)
          let toolResults = '';
          for (const toolCall of result.toolCalls) {
            const toolResult = await this.executeToolCall(toolCall);
            toolResults += `Tool ${toolCall.toolName} result:\n${toolResult}\n\n`;
          }

          if (toolResults) {
            messages.push({
              role: 'user',
              content: `Tool results:

${toolResults}`,
            });

            // Log current message history size
            const currentTokens = messages.reduce(
              (sum, msg) => sum + this.estimateTokens(msg.content),
              0
            );
            console.log(
              `📈 Message history: ${messages.length} messages, ~${currentTokens.toLocaleString()} tokens`
            );
          }

          // After tool execution, check if we have sufficient understanding
          const hasExploredStructure = messages.some(
            (m) =>
              m.content?.includes('explored the codebase structure') ||
              m.content?.includes('appears to be')
          );
          const hasAnalyzedChanges = messages.some(
            (m) =>
              m.content?.includes('analyzed the changes') ||
              m.content?.includes('files mentioned in the diff')
          );

          if (totalToolCalls < 3) {
            // Force initial exploration
            messages.push({
              role: 'user',
              content:
                'You must use tools to explore the codebase. Start with list_directory on "." to see the project structure, then use find_files to locate configuration files like "*.json" or "*.config.*".',
            });
          } else if (!hasExploredStructure && totalToolCalls < 8) {
            messages.push({
              role: 'user',
              content:
                'Continue with Phase 1: Explore the codebase structure first to understand the project context. Use list_directory and find_files to understand the repository organization.',
            });
          } else if (!hasAnalyzedChanges && totalToolCalls < 15) {
            messages.push({
              role: 'user',
              content:
                'Continue with Phase 2: Now analyze the specific changes. Read the files mentioned in the diff and explore related code.',
            });
          } else if (hasExploredStructure && hasAnalyzedChanges && result.text.length < 500) {
            messages.push({
              role: 'user',
              content:
                'You have gathered sufficient context. Now provide your comprehensive final analysis with specific findings based on your understanding of both the codebase and the changes.',
            });
          }
        } else {
          // No more tool calls - check if we have sufficient analysis
          const hasExploredStructure = messages.some(
            (m) =>
              m.content?.includes('explored the codebase structure') ||
              m.content?.includes('appears to be')
          );
          const hasAnalyzedChanges = messages.some(
            (m) =>
              m.content?.includes('analyzed the changes') ||
              m.content?.includes('files mentioned in the diff')
          );

          // More lenient check for comprehensive analysis
          const hasComprehensiveAnalysis = result.text.length > 2000 && totalToolCalls >= 10;

          if (hasExploredStructure && hasAnalyzedChanges && hasComprehensiveAnalysis) {
            console.log(
              `✅ Analysis complete: ${totalToolCalls} tools used, ${result.text.length} character response, max tokens: ${this.maxTokensUsed.toLocaleString()} (${(this.maxTokensUsed / 1000000).toFixed(2)}M)`
            );
            return this.formatAnalysisResult(messages, result.text);
          } else if (totalToolCalls < 5) {
            // Force tool usage if not enough tools have been called
            messages.push({
              role: 'user',
              content: `IMPORTANT: You must use tools to analyze the code. You've only used ${totalToolCalls} tools so far. Use list_directory to explore directories, find_files to locate files, read_file to read content, and search_content to find patterns. DO NOT just write analysis without using tools.`,
            });
          } else if (!hasExploredStructure) {
            // Need to explore codebase structure
            messages.push({
              role: 'user',
              content: `You need to understand the codebase first. Use list_directory and find_files to explore the repository structure and understand the project context. You must call these tools, not just describe what you would do.`,
            });
          } else if (!hasAnalyzedChanges) {
            // Need to analyze the actual changes
            messages.push({
              role: 'user',
              content:
                'Now analyze the specific changes in the diff. Use read_file to read the changed files and search_content to find related code. You must call these tools.',
            });
          } else {
            // Need more comprehensive analysis
            messages.push({
              role: 'user',
              content:
                'Continue exploring with tools. Use read_file to read more files, search_content to find patterns, and list_directory to explore more directories. You need at least 10 tool calls for a thorough review.',
            });
          }
        }
      }

      // If we've reached max turns, get final summary
      console.log(`⏰ Reached max turns (${maxTurns}), requesting final summary...`);

      // Compress messages for final summary
      const compressedMessages = this.compressMessageHistory(messages);
      const finalResult = await this.makeRetryingLLMCall(async () => {
        return this.provider.generateText({
          messages: [
            ...compressedMessages,
            {
              role: 'user',
              content: `Based on your exploration of the codebase and analysis using ${totalToolCalls} tools, provide your comprehensive final code review.

Your review should demonstrate understanding of:
1. The overall codebase architecture and patterns
2. How the changes fit into the existing system
3. Specific issues or improvements needed

Include analysis of security, bugs, performance, code quality, and actionable recommendations that align with the project's conventions.`,
            },
          ],
          systemPrompt,
          temperature: 0.1,
          maxTokens: 4000,
        });
      });

      return this.formatAnalysisResult(messages, finalResult.text);
    } catch (error: any) {
      throw new Error(`Error during analysis: ${error.message}`);
    }
  }

  /**
   * Phase 2: Generate structured review output
   */
  private async generateStructuredReview(analysisResult: string): Promise<ReviewOutput> {
    const structuredPrompt = `Based on the following comprehensive code analysis, create a structured code review that demonstrates deep understanding of both the changes and the codebase context.

## Analysis Context
${analysisResult}

## Your Task
Generate a structured JSON review that reflects your understanding of:
1. The codebase architecture and conventions
2. How the changes fit into the existing system
3. Specific issues found in the context of the project
4. Improvements that align with project patterns

## JSON Structure Required
{
  "summary": "Brief overall assessment that shows understanding of both the changes and the codebase context",
  "confidence": 0.85,
  "confidence_reasoning": "Explain your confidence based on: (1) how well you understood the codebase, (2) clarity of the changes, (3) amount of context gathered",
  "issues": [
    {
      "type": "bug|security|performance|style|maintainability|testing",
      "severity": "critical|high|medium|low",
      "title": "Short, specific issue description (max 100 chars)",
      "description": "Detailed explanation including: (1) what the issue is, (2) why it's problematic in this codebase, (3) how it relates to existing patterns",
      "file": "exact/path/from/diff.ts",
      "line": 42,
      "confidence": 0.8,
      "confidence_reasoning": "Why you're confident, referencing specific evidence from your exploration",
      "suggestion": "Specific fix that aligns with codebase conventions and patterns you observed"
    }
  ],
  "positive_aspects": [
    {
      "title": "What aligns well with codebase patterns (max 100 chars)",
      "description": "Explanation of why this is good in the context of this specific project"
    }
  ],
  "suggestions": [
    {
      "type": "improvement|refactor|testing|documentation",
      "title": "Enhancement that fits the project (max 100 chars)",
      "description": "Detailed suggestion that: (1) explains the improvement, (2) references similar patterns in the codebase, (3) provides specific implementation guidance",
      "priority": "high|medium|low"
    }
  ]
}

## Critical Requirements
1. **Contextual Accuracy**: Every issue/suggestion must reference the actual codebase context you discovered
2. **Pattern Consistency**: Suggestions should follow patterns you observed in the repository
3. **Specific File/Line References**: Use exact paths and line numbers from the diff
4. **Confidence Justification**: Base confidence on actual evidence from your exploration
5. **Empty Arrays**: Use [] if no issues/aspects/suggestions found - don't fabricate
6. **Project Alignment**: All feedback should respect the project's architecture and conventions

## Examples of Good Contextual Feedback
- "This breaks the existing error handling pattern used throughout the /src/core directory"
- "Consider using the project's established validation schema pattern seen in schemas.ts"
- "This change is inconsistent with the testing approach in other test files"
- "Following the project's convention, this should be in the /src/utils directory"

## Examples of Poor Generic Feedback (Avoid)
- "Consider adding error handling" (too generic)
- "This could be more efficient" (not specific)
- "Add tests" (doesn't reference testing patterns)
- "Improve naming" (doesn't reference conventions)

Remember: Your review should demonstrate that you understand this specific codebase, not just general programming principles.`;

    console.log(
      `🔄 Generating structured review from ${analysisResult.length} character analysis...`
    );

    const result = await this.makeRetryingLLMCall(async () => {
      return this.provider.generateObject(structuredPrompt, reviewOutputSchema);
    });

    console.log(`✅ Structured review generated successfully`);
    return result as any;
  }

  private createSystemPrompt(): string {
    return `You are an expert code review assistant who understands that comprehensive reviews require deep contextual understanding.

## Core Review Principles
1. **Understand the Codebase First**: Grasp the architecture, patterns, and conventions before reviewing changes
2. **Context-Aware Analysis**: Recognize how changes fit into the larger system and existing patterns
3. **Actionable Feedback**: Provide specific, implementable suggestions that align with the project
4. **Prioritized Issues**: Focus on security > correctness > performance > maintainability > style
5. **Pattern Recognition**: Identify both good patterns to follow and anti-patterns to avoid

## Available Tools for Analysis
- **list_directory**: Explore project structure and understand organization
- **find_files**: Discover related files, tests, and configurations
- **read_file**: Read complete file content to understand implementation
- **search_content**: Search for patterns, usage, and similar code across the codebase

## Review Approach
1. **Understand the Repository**
   - Explore the project structure to understand architecture
   - Identify key directories and their purposes
   - Recognize testing patterns and configuration approach
   - Understand dependencies and technology stack

2. **Analyze Changes in Context**
   - Read changed files thoroughly
   - Understand the purpose and scope of changes
   - Check how changes integrate with existing code
   - Verify consistency with codebase patterns

3. **Provide Contextual Feedback**
   - Reference similar patterns in the codebase
   - Suggest improvements that align with project conventions
   - Identify potential impacts on other parts of the system
   - Recommend tests based on existing test patterns

## Quality Standards
- Every issue should reference specific code and explain the context
- Suggestions should be consistent with existing codebase patterns
- Consider both immediate changes and broader architectural implications
- Provide confidence levels based on your understanding of the codebase

Remember: A good review understands not just what changed, but why it matters in the context of the entire system.`;
  }

  private createDiffContext(diffContent: string): string {
    return `You are conducting a comprehensive code review that requires understanding both the codebase and the specific changes.

## Your Code Review Task

Review the following code changes with a deep understanding of the codebase context:

\`\`\`diff
${diffContent}
\`\`\`

## Review Process

### Phase 1: Understand the Codebase (Initial Exploration)
Start by gaining a high-level understanding of the repository:
1. Use **list_directory** on the root to understand project structure
2. Use **find_files** to locate key configuration files (package.json, deno.json, *.config.*, etc.)
3. Use **list_directory** on major directories to understand organization
4. Use **find_files** to discover test files and understand testing patterns

After initial exploration, summarize: "I've explored the codebase structure. This appears to be a [type] project using [technologies]..."

### Phase 2: Analyze the Changes (Focused Investigation)
Now focus on understanding the specific changes:
1. Use **read_file** on ALL files mentioned in the diff
2. Use **list_directory** on directories containing changed files
3. Use **find_files** to locate related test files for changed code
4. Use **search_content** to find usage of modified functions/classes
5. Use **search_content** to find similar patterns in the codebase

After analyzing changes, summarize: "I've analyzed the changes which appear to [describe purpose]..."

### Phase 3: Deep Contextual Analysis (As Needed)
Based on what you've found, perform deeper investigation:
1. Use **read_file** on files that import or depend on changed code
2. Use **search_content** for patterns like "TODO", "FIXME", "DEPRECATED" near changed code
3. Use **find_files** to check for documentation that might need updating
4. Use **search_content** to verify consistent patterns across the codebase
5. Explore any areas that need clarification for a complete review

After deep analysis, provide your initial findings before the final review.

### Phase 4: Comprehensive Review
Provide a detailed review that includes:

1. **Change Summary**: What was changed and why (based on your analysis)
2. **Codebase Context**: How these changes fit into the existing architecture
3. **Security Analysis**: Any security implications of the changes
4. **Bug Analysis**: Potential bugs or logic errors introduced
5. **Performance Considerations**: Performance impacts of the changes
6. **Code Quality**: Consistency with codebase patterns and conventions
7. **Testing Assessment**: Whether changes are properly tested
8. **Integration Points**: How changes affect other parts of the system
9. **Suggestions**: Specific, actionable improvements aligned with the codebase

## Important Guidelines

- **Quality over Quantity**: Use tools strategically to understand the code, not to meet a count
- **Adaptive Exploration**: Simple changes need less exploration; complex changes need more
- **Context Matters**: Always consider how changes fit into the larger codebase
- **Pattern Consistency**: Check if changes follow existing patterns in the repository
- **Focus on Impact**: Prioritize issues based on their potential impact
- **Actionable Feedback**: Every issue should have a clear, implementable solution

## Tool Usage Strategy

- Start broad (project structure) then narrow down (specific changes)
- Read changed files completely before exploring related code
- Use search to understand patterns and find similar code
- Explore until you have sufficient context for a thorough review
- Stop exploring when you have enough information (no minimum required)

Remember: The goal is understanding the changes in context, not just finding issues. A good review shows understanding of both what changed and how it fits into the whole system.`;
  }

  private getToolDefinitions(): ToolDefinition[] {
    return tools;
  }

  /**
   * Execute a single tool call manually
   */
  private async executeToolCall(toolCall: ToolCall): Promise<string> {
    const { toolName, args } = toolCall;

    try {
      switch (toolName) {
        case 'read_file':
          return await readFile(args.file_path, this.toolContext);
        case 'list_directory':
          return await listDirectory(args.directory_path, this.toolContext);
        case 'find_files':
          return await findFiles(args.pattern, this.toolContext);
        case 'search_content':
          return await searchContent(args.query, this.toolContext);
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (error: any) {
      return `Error executing ${toolName}: ${error.message}`;
    }
  }

  /**
   * Extract conversation history from AI SDK v5 steps for structured review
   */
  private extractConversationFromSteps(result: any): string {
    console.log(`🔍 Extracting conversation from AI SDK v5 result...`);

    // Log all available properties for debugging
    console.log(`🔍 Available result properties:`, Object.keys(result));
    if (result.steps) {
      console.log(`📋 Steps available: ${result.steps.length}`);
    }

    let conversationSummary = '# AI Analysis Conversation Summary\n\n';

    // If we have steps, extract the conversation flow
    if (result.steps && result.steps.length > 0) {
      conversationSummary += '## Multi-Step Analysis History\n';
      result.steps.forEach((step: any, i: number) => {
        console.log(`📋 Step ${i}: keys=${Object.keys(step)}`);
        conversationSummary += `\n### Step ${i + 1}\n`;

        // Extract content from this step
        if (step.content && typeof step.content === 'string') {
          conversationSummary += `**AI Response**: ${step.content.substring(0, 500)}${step.content.length > 500 ? '...' : ''}\n\n`;
        } else if (step.content && Array.isArray(step.content)) {
          step.content.forEach((contentItem: any, j: number) => {
            if (
              contentItem &&
              contentItem.type === 'text' &&
              contentItem.text &&
              typeof contentItem.text === 'string'
            ) {
              conversationSummary += `**AI Text ${j + 1}**: ${contentItem.text.substring(0, 300)}${contentItem.text.length > 300 ? '...' : ''}\n\n`;
            }
          });
        }

        // Extract reasoning if available
        if (step.reasoning) {
          const reasoningText =
            typeof step.reasoning === 'string' ? step.reasoning : JSON.stringify(step.reasoning);
          conversationSummary += `**Reasoning**: ${reasoningText.substring(0, 300)}${reasoningText.length > 300 ? '...' : ''}\n\n`;
        }

        // Extract tool calls from this step
        if (step.toolCalls && step.toolCalls.length > 0) {
          conversationSummary += `**Tools Called (${step.toolCalls.length})**:\n`;
          step.toolCalls.forEach((tc: any) => {
            conversationSummary += `- ${tc.toolName}: ${JSON.stringify(tc.args || tc.input)}\n`;
          });
          conversationSummary += '\n';
        }

        // Extract tool results from this step
        if (step.toolResults && step.toolResults.length > 0) {
          conversationSummary += `**Tool Results (${step.toolResults.length})**:\n`;
          step.toolResults.forEach((tr: any, j: number) => {
            if (tr && tr.result !== undefined) {
              const resultPreview =
                typeof tr.result === 'string'
                  ? tr.result.substring(0, 200)
                  : JSON.stringify(tr.result).substring(0, 200);
              conversationSummary += `- Result ${j + 1}: ${resultPreview}${resultPreview.length >= 200 ? '...' : ''}\n`;
            }
          });
          conversationSummary += '\n';
        }
      });
    }

    // Add information about tool calls that were made
    if (result.toolCalls && result.toolCalls.length > 0) {
      conversationSummary += `\n## Tools Used (${result.toolCalls.length} total)\n`;
      result.toolCalls.forEach((tc: any) => {
        conversationSummary += `- ${tc.toolName}: ${JSON.stringify(tc.args || tc.input)}\n`;
      });
    }

    // Add final content and reasoning from the root level
    if (result.content && typeof result.content === 'string') {
      conversationSummary += `\n## Final AI Analysis\n${result.content}\n`;
    } else if (result.content && Array.isArray(result.content)) {
      conversationSummary += `\n## Final AI Analysis\n`;
      result.content.forEach((contentItem: any) => {
        if (
          contentItem &&
          contentItem.type === 'text' &&
          contentItem.text &&
          typeof contentItem.text === 'string'
        ) {
          conversationSummary += `${contentItem.text}\n\n`;
        }
      });
    }

    if (result.reasoning) {
      const reasoningText =
        typeof result.reasoning === 'string' ? result.reasoning : JSON.stringify(result.reasoning);
      conversationSummary += `\n## AI Reasoning\n${reasoningText}\n`;
    }

    if (result.toolResults && result.toolResults.length > 0) {
      conversationSummary += `\n## Final Tool Results (${result.toolResults.length})\n`;
      result.toolResults.forEach((tr: any) => {
        if (tr && tr.result !== undefined) {
          const resultPreview =
            typeof tr.result === 'string'
              ? tr.result.substring(0, 300)
              : JSON.stringify(tr.result).substring(0, 300);
          conversationSummary += `- ${tr.toolName || 'Tool'} Result: ${resultPreview}${resultPreview.length >= 300 ? '...' : ''}\n`;
        }
      });
    }

    // Add any direct text response (fallback)
    if (result.text && result.text.trim()) {
      conversationSummary += `\n## Direct Response Text\n${result.text}\n`;
    }

    console.log(`📝 Generated conversation summary: ${conversationSummary.length} characters`);
    return conversationSummary;
  }

  private formatAnalysisResult(messages: Message[], finalResponse: string): string {
    return `# Code Analysis Complete

## Analysis Process
The AI assistant conducted a thorough analysis of the code changes using available tools with AI SDK v5 automatic execution.

## Key Findings
${finalResponse}

## Final Analysis
Analysis completed using AI SDK v5 with automatic tool execution.`;
  }

  private async makeRetryingLLMCall<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        // Check if it's a rate limit error (429)
        if (error.message?.includes('429') && attempt < 3) {
          let delay = 60; // Default 60 second delay

          // Try to extract retry-after header if available
          const retryAfterMatch = error.message.match(/retry[- ]after[:\s]*(\d+)/i);
          if (retryAfterMatch) {
            delay = parseInt(retryAfterMatch[1], 10);
          }

          console.log(`⏳ Rate limited, retrying in ${delay}s... (attempt ${attempt}/3)`);
          await this.sleep(delay * 1000);
          continue;
        }

        // Re-throw if not a rate limit error or final attempt
        throw error;
      }
    }

    throw new Error('Max retry attempts reached');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Estimate token count for a given text
   * Uses OpenAI's rule of thumb: ~4 characters per token
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Compress message history to manage context window
   * Keeps: diff, all LLM analysis, most recent tool batch, user guidance
   * Compresses: older tool results into brief summaries
   */
  private compressMessageHistory(messages: Message[]): Message[] {
    if (messages.length <= 6) return messages;

    const compressed: Message[] = [];
    let toolResultsSummary = '';
    let lastAssistantIndex = -1;

    // Find the last assistant message (to identify most recent batch)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'assistant') {
        lastAssistantIndex = i;
        break;
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue; // Skip undefined messages

      // Always keep first message (has the diff)
      if (i === 0) {
        compressed.push(msg);
        continue;
      }

      // Keep all assistant messages intact
      if (msg.role === 'assistant') {
        compressed.push(msg);
        continue;
      }

      // For user messages with tool results
      if (msg.role === 'user' && msg.content.includes('Tool results:')) {
        // Keep if it's after the last assistant message (most recent batch)
        if (i > lastAssistantIndex) {
          compressed.push(msg);
        } else {
          // Compress older tool results
          const toolMatches = msg.content.match(/Tool (\w+) result:/g) || [];
          toolResultsSummary += toolMatches.map((m) => m.replace(' result:', '')).join(', ') + '; ';
        }
      } else {
        // Keep other user messages
        compressed.push(msg);
      }
    }

    // Add summary of compressed tools if any
    if (toolResultsSummary) {
      compressed.splice(1, 0, {
        role: 'user',
        content: `[Earlier explorations: ${toolResultsSummary}Results available if needed.]`,
      });
    }

    return compressed;
  }
}
