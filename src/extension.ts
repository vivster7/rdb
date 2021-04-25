import * as vscode from 'vscode';

import activateDebugger from './activateDebugger';

export function activate(context: vscode.ExtensionContext) {
	activateDebugger(context);
}

export function deactivate() {
	// nothing to do
}

