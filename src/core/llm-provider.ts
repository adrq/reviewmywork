export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolInvocations?: ToolInvocation[];
}

export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface GenerateTextParams {
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number; // AI SDK v5 feature for automatic tool execution
}

export interface GenerateTextResult {
  text: string;
  toolCalls?: ToolCall[];
  rawResult?: any; // For accessing provider-specific result data
}

/**
 * Minimal LLM provider interface for any model provider
 * (Vercel AI SDK, VSCode LLM APIs, direct API calls, etc.)
 */
export interface LLMProvider {
  /**
   * Generate text with optional tool calling support
   * @param params Generation parameters
   * @returns Generated text and any tool calls made
   */
  generateText(params: GenerateTextParams): Promise<GenerateTextResult>;

  /**
   * Generate structured object using schema validation
   * @param prompt The prompt for object generation
   * @param schema Zod schema for validation
   * @returns Validated object matching the schema
   */
  generateObject<T>(prompt: string, schema: any): Promise<T>;
}
