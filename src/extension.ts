import * as vscode from 'vscode';
import { VERSION } from '@/core/version';

export function activate(context: vscode.ExtensionContext) {
  console.log('🚀 ReviewMyWork extension v' + VERSION + ' is now active!');
  console.log('📝 Extension context:', context.extensionPath);

  // Register the main command
  const disposable = vscode.commands.registerCommand('reviewmywork.review', () => {
    console.log('🎯 Command reviewmywork.review executed!');

    // Try multiple notification methods to ensure visibility
    vscode.window.showInformationMessage(
      `Hello from ReviewMyWork v${VERSION}! 🎉 TypeScript rewrite in progress...`
    );

    vscode.window.showWarningMessage(`⚠️ TESTING: ReviewMyWork Extension Working! v${VERSION}`);

    console.log('📢 Both information and warning messages sent!');
  });

  context.subscriptions.push(disposable);

  // List all commands to verify registration
  vscode.commands.getCommands().then((commands) => {
    const ourCommands = commands.filter((cmd) => cmd.includes('reviewmywork'));
    console.log('🔍 ReviewMyWork commands found:', ourCommands);
  });

  // Log successful activation
  console.log('✅ ReviewMyWork extension activated successfully');
}

export function deactivate() {
  console.log('👋 ReviewMyWork extension deactivated');
}
