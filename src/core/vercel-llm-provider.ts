import { azure } from '@ai-sdk/azure';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, generateObject } from 'ai';
import {
  LLMProvider,
  GenerateTextParams,
  GenerateTextResult,
  ToolDefinition,
} from './llm-provider.ts';

import { Settings } from './config.ts';
import { ToolContext } from './tools.ts';
import { z } from 'zod';

/**
 * Vercel AI SDK provider implementation
 * Supports Azure OpenAI, OpenAI, and Anthropic models
 */
export class VercelLLMProvider implements LLMProvider {
  private model: any;
  private toolContext?: ToolContext;

  constructor(config: Settings) {
    this.model = this.createVercelModel(config);
  }

  setToolContext(toolContext: ToolContext) {
    this.toolContext = toolContext;
  }

  async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
    console.log(`🚀 Starting generateText with ${params.tools?.length || 0} tools available`);
    if (params.maxSteps) {
      console.log(`🔄 Using AI SDK v5 automatic execution with maxSteps: ${params.maxSteps}`);
    }

    const generateParams: any = {
      model: this.model,
      messages: params.messages.map((msg) => {
        if (msg.role === 'tool' && msg.toolInvocations?.[0]?.toolCallId) {
          return {
            role: 'tool' as const,
            content: msg.content,
            toolCallId: msg.toolInvocations[0].toolCallId,
          };
        }
        return {
          role: msg.role as any,
          content: msg.content,
        };
      }),
      tools: params.tools ? this.convertToolsToVercelFormat(params.tools) : undefined,
      system: params.systemPrompt,
      temperature: params.temperature || 0.1,
      toolChoice: params.tools ? 'auto' : undefined,
    };

    // Add maxSteps if provided (AI SDK v5 feature)
    if (params.maxSteps) {
      generateParams.maxSteps = params.maxSteps;
    }

    console.log(`📡 Making AI SDK generateText call...`);
    const result = await (generateText as any)(generateParams);

    console.log(`✅ AI SDK generateText completed`);
    console.log(`📝 Response text length: ${result.text?.length || 0} characters`);
    console.log(`🔧 Tool calls returned: ${result.toolCalls?.length || 0}`);

    // Debug: Log all properties of the result to understand AI SDK v5 structure
    console.log(`🔍 Full result properties:`, Object.keys(result));
    console.log(
      `🔍 resolvedOutput:`,
      result.resolvedOutput ? typeof result.resolvedOutput : 'undefined'
    );
    if (result.resolvedOutput && typeof result.resolvedOutput === 'string') {
      console.log(`🔍 resolvedOutput length:`, result.resolvedOutput.length);
    }
    if (result.steps) {
      console.log(`📋 Steps available: ${result.steps?.length || 0}`);
      if (result.steps?.length > 0) {
        result.steps.forEach((step: any, i: number) => {
          console.log(`📋 Step ${i}: type=${step.type}, text_length=${step.text?.length || 0}`);
        });
        const lastStep = result.steps[result.steps.length - 1];
        console.log(`📋 Last step type:`, lastStep?.type);
        if (lastStep?.type === 'text' && lastStep.text) {
          console.log(`📋 Last step text length: ${lastStep.text.length} characters`);
        }
      }
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log(
        `🔧 Tool calls:`,
        result.toolCalls.map((tc: any) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          input: tc.input,
        }))
      );
    }

    // Extract text from AI SDK v5 result - check text, resolvedOutput, and steps
    let finalText = result.text || '';

    // Check resolvedOutput if no direct text
    if (!finalText && result.resolvedOutput && typeof result.resolvedOutput === 'string') {
      finalText = result.resolvedOutput;
      console.log(`📋 Extracted text from resolvedOutput: ${finalText.length} characters`);
    }

    // If no direct text but we have steps, extract text from the last text step
    if (!finalText && result.steps && result.steps.length > 0) {
      // Find the last text step (AI SDK v5 stores final text in steps)
      for (let i = result.steps.length - 1; i >= 0; i--) {
        const step = result.steps[i];
        if (step.type === 'text' && step.text && step.text.trim()) {
          finalText = step.text;
          console.log(`📋 Extracted text from step ${i}: ${step.text.length} characters`);
          break;
        }
      }
    }

    return {
      text: finalText,
      toolCalls: result.toolCalls?.map((tc: any) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.input, // AI SDK v5 uses 'input' not 'args'
      })),
      // Pass through the full result for conversation extraction
      rawResult: result,
    };
  }

  async generateObject<T>(prompt: string, schema: any): Promise<T> {
    console.log(`🔍 generateObject: Starting with prompt length: ${prompt.length}`);
    console.log(`🔍 generateObject: Schema type: ${schema?.constructor?.name || typeof schema}`);

    try {
      const result = await (generateObject as any)({
        model: this.model,
        prompt,
        schema,
        temperature: 0.1,
      });

      console.log(`✅ generateObject: Success, object keys:`, Object.keys(result.object || {}));
      return result.object;
    } catch (error: any) {
      console.error(`❌ generateObject: Error:`, error.message);
      console.error(`❌ generateObject: Full error:`, error);

      // If it's a schema validation error, try to see what was actually generated
      if (error.message?.includes('schema') || error.message?.includes('object')) {
        console.error(`❌ generateObject: This looks like a schema validation error`);
        if (error.response || error.data) {
          console.error(`❌ generateObject: Error response:`, error.response || error.data);
        }
      }

      throw error;
    }
  }

  private convertToolsToVercelFormat(tools: ToolDefinition[]) {
    const vercelTools: Record<string, any> = {};

    for (const tool of tools) {
      // Convert our JSON Schema tools to AI SDK v5 format with Zod schemas and execute functions
      let inputSchema;
      let executeFunction;

      switch (tool.function.name) {
        case 'read_file':
          inputSchema = z.object({
            file_path: z.string().describe('Path to the file to read'),
          });
          executeFunction = async ({ file_path }: { file_path: string }) => {
            console.log(`🔧 AI SDK executing read_file with path: ${file_path}`);
            const startTime = Date.now();
            try {
              const { readFile } = await import('./tools.ts');
              const result = await readFile(file_path, this.toolContext!);
              const duration = Date.now() - startTime;
              console.log(`🔧 read_file completed successfully [${duration}ms]`);
              return result;
            } catch (error: any) {
              const duration = Date.now() - startTime;
              console.log(`🔧 read_file failed: ${error.message} [${duration}ms]`);
              throw error;
            }
          };
          break;
        case 'list_directory':
          inputSchema = z.object({
            directory_path: z.string().describe('Path to the directory to list'),
          });
          executeFunction = async ({ directory_path }: { directory_path: string }) => {
            console.log(`🔧 AI SDK executing list_directory with path: ${directory_path}`);
            const startTime = Date.now();
            try {
              const { listDirectory } = await import('./tools.ts');
              const result = await listDirectory(directory_path, this.toolContext!);
              const duration = Date.now() - startTime;
              console.log(`🔧 list_directory completed successfully [${duration}ms]`);
              return result;
            } catch (error: any) {
              const duration = Date.now() - startTime;
              console.log(`🔧 list_directory failed: ${error.message} [${duration}ms]`);
              throw error;
            }
          };
          break;
        case 'find_files':
          inputSchema = z.object({
            pattern: z.string().describe('File pattern to search for (e.g., "*.ts", "README*")'),
          });
          executeFunction = async ({ pattern }: { pattern: string }) => {
            console.log(`🔧 AI SDK executing find_files with pattern: ${pattern}`);
            const startTime = Date.now();
            try {
              const { findFiles } = await import('./tools.ts');
              const result = await findFiles(pattern, this.toolContext!);
              const duration = Date.now() - startTime;
              console.log(`🔧 find_files completed successfully [${duration}ms]`);
              return result;
            } catch (error: any) {
              const duration = Date.now() - startTime;
              console.log(`🔧 find_files failed: ${error.message} [${duration}ms]`);
              throw error;
            }
          };
          break;
        case 'search_content':
          inputSchema = z.object({
            query: z.string().describe('Text pattern to search for in file contents'),
          });
          executeFunction = async ({ query }: { query: string }) => {
            console.log(`🔧 AI SDK executing search_content with query: ${query}`);
            const startTime = Date.now();
            try {
              const { searchContent } = await import('./tools.ts');
              const result = await searchContent(query, this.toolContext!);
              const duration = Date.now() - startTime;
              console.log(`🔧 search_content completed successfully [${duration}ms]`);
              return result;
            } catch (error: any) {
              const duration = Date.now() - startTime;
              console.log(`🔧 search_content failed: ${error.message} [${duration}ms]`);
              throw error;
            }
          };
          break;
        default:
          throw new Error(`Unknown tool: ${tool.function.name}`);
      }

      vercelTools[tool.function.name] = {
        description: tool.function.description,
        inputSchema,
        execute: executeFunction,
      };
    }

    console.log(
      `🔍 Configured ${Object.keys(vercelTools).length} tools for AI SDK v5:`,
      Object.keys(vercelTools)
    );
    return vercelTools;
  }

  private createVercelModel(config: Settings) {
    switch (config.provider) {
      case 'azure':
        // Set required environment variables for Azure provider
        if (config.azureResourceName) {
          Deno.env.set('AZURE_RESOURCE_NAME', config.azureResourceName);
        }
        if (config.apiKey) {
          Deno.env.set('AZURE_API_KEY', config.apiKey);
        }
        if (config.azureApiVersion) {
          Deno.env.set('AZURE_API_VERSION', config.azureApiVersion);
        }
        return (azure as any)(config.azureDeployment || config.model);

      case 'openai':
        if (config.apiKey) {
          Deno.env.set('OPENAI_API_KEY', config.apiKey);
        }
        return (openai as any)(config.model);

      case 'anthropic':
        if (config.apiKey) {
          Deno.env.set('ANTHROPIC_API_KEY', config.apiKey);
        }
        return (anthropic as any)(config.model);

      default:
        // Set required environment variables for Azure provider
        if (config.azureResourceName) {
          Deno.env.set('AZURE_RESOURCE_NAME', config.azureResourceName);
        }
        if (config.apiKey) {
          Deno.env.set('AZURE_API_KEY', config.apiKey);
        }
        if (config.azureApiVersion) {
          Deno.env.set('AZURE_API_VERSION', config.azureApiVersion);
        }
        return (azure as any)(config.azureDeployment || config.model);
    }
  }
}
