/**
 * Minimal configuration loading for MVP
 * No validation - just read environment variables with sensible defaults
 */

export interface Settings {
  provider: string;
  model: string;
  apiKey?: string;
  azureResourceName?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
  toolTimeout: number;
  maxTurns: number;
  llmTimeout: number;
}

/**
 * Load settings from environment variables
 */
export function loadCLISettings(): Settings {
  return {
    provider: Deno.env.get('REVIEWMYWORK_PROVIDER') || 'azure',
    model: Deno.env.get('REVIEWMYWORK_MODEL') || 'gpt-4',
    apiKey:
      Deno.env.get('AZURE_API_KEY') ||
      Deno.env.get('OPENAI_API_KEY') ||
      Deno.env.get('ANTHROPIC_API_KEY'),
    azureResourceName: Deno.env.get('AZURE_RESOURCE_NAME'),
    azureDeployment: Deno.env.get('AZURE_DEPLOYMENT'),
    azureApiVersion: Deno.env.get('AZURE_API_VERSION') || '2024-02-15-preview',
    toolTimeout: parseInt(Deno.env.get('REVIEWMYWORK_TOOL_TIMEOUT') || '120'),
    maxTurns: parseInt(Deno.env.get('REVIEWMYWORK_MAX_TURNS') || '10'),
    llmTimeout: parseInt(Deno.env.get('REVIEWMYWORK_LLM_TIMEOUT') || '180'),
  } as Settings;
}

/**
 * Load settings from VSCode configuration
 */
export async function loadVSCodeSettings(context: any): Promise<Settings> {
  const vscode = await import('vscode');
  const config = vscode.workspace.getConfiguration('reviewmywork');

  return {
    provider: (config.get as any)('provider') || 'azure',
    model: (config.get as any)('model') || 'gpt-4',
    apiKey: await context.secrets.get('reviewmywork.apiKey'),
    azureResourceName: (config.get as any)('azureResourceName'),
    azureDeployment: (config.get as any)('azureDeployment'),
    azureApiVersion: (config.get as any)('azureApiVersion') || '2024-02-15-preview',
    toolTimeout: (config.get as any)('toolTimeout') || 120,
    maxTurns: (config.get as any)('maxTurns') || 10,
    llmTimeout: (config.get as any)('llmTimeout') || 180,
  } as Settings;
}
