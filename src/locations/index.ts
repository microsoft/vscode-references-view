/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolsTree } from '../tree';
import { FileItem, LocationsModel, LocationTreeInput, ReferenceItem } from './model';

export function register(tree: SymbolsTree, context: vscode.ExtensionContext): void {

	function findLocations(title: string, command: string) {
		if (vscode.window.activeTextEditor) {
			const input = new LocationTreeInput(title, vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.selection.active, command);
			tree.setInput(input);
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('references-view.findReferences', () => findLocations('References', 'vscode.executeReferenceProvider')),
		vscode.commands.registerCommand('references-view.findImplementations', () => findLocations('Implementations', 'vscode.executeImplementationProvider')),
		// --- legacy name
		vscode.commands.registerCommand('references-view.find', function () { return vscode.commands.executeCommand('references-view.findReferences', ...arguments); }),
		vscode.commands.registerCommand('references-view.showReferenceItem', (item, preserveFocus?: boolean) => {
			if (item instanceof ReferenceItem) {
				return vscode.commands.executeCommand('vscode.open', item.location.uri, {
					selection: new vscode.Range(item.location.range.start, item.location.range.start),
					preserveFocus
				});
			}
		}),
		vscode.commands.registerCommand('references-view.copy', copyCommand),
		vscode.commands.registerCommand('references-view.copyAll', copyAllCommand),
		vscode.commands.registerCommand('references-view.copyPath', copyPathCommand),
	);
}

const copyAllCommand = async (item: ReferenceItem | FileItem | unknown) => {
	if (item instanceof ReferenceItem) {
		copyCommand(item.file.model);
	} else if (item instanceof FileItem) {
		copyCommand(item.model);
	}
};

const copyCommand = async (item: LocationsModel | ReferenceItem | FileItem | unknown) => {
	let val: string | undefined;
	if (item instanceof LocationsModel) {
		val = await item.asCopyText();
	} else if (item instanceof ReferenceItem) {
		val = await item.asCopyText();
	} else if (item instanceof FileItem) {
		val = await item.asCopyText();
	}
	if (val) {
		await vscode.env.clipboard.writeText(val);
	}
};

const copyPathCommand = (item: FileItem | unknown) => {
	if (item instanceof FileItem) {
		if (item.uri.scheme === 'file') {
			vscode.env.clipboard.writeText(item.uri.fsPath);
		} else {
			vscode.env.clipboard.writeText(item.uri.toString(true));
		}
	}
};
