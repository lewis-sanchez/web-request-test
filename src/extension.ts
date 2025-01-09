// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as os from 'os';
import { makeGetRequest } from './network/request';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('web-request-test.makeWebRequest', async () => {
		// Prompt the user for input
		const requestUrl = await vscode.window.showInputBox({
			placeHolder: 'https://www.example.com',
			prompt: 'Enter URL to make a request to (Press \'Enter\' to confirm or \'Escape\' to cancel)'
		});

		// Display the input back to the user
		if (requestUrl) {
			console.log('Making request to URL: ', requestUrl);
			try {
				let response = await makeGetRequest<any>(requestUrl);


				if (response) {
					const eol = getEOL();
					const document = await vscode.workspace.openTextDocument({ content: `Made request to: ${requestUrl}${eol} Status:${response.status} - ${response.statusText}${eol}` });
					await vscode.window.showTextDocument(document);
				}
			}
			catch (error) {
				console.error('Error making request: ', error);
			}
		}
	});

	context.subscriptions.push(disposable);
}

function getEOL() {
	return os.platform() !== 'win32' ? '\r\n' : '\n';
}

// This method is called when your extension is deactivated
export function deactivate() { }
