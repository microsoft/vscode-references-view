/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolTreeInput } from './api';
import * as calls from './calls';
import * as locations from './locations';
import { SymbolsTree } from './tree';

export function activate(context: vscode.ExtensionContext) {

	const tree = new SymbolsTree();

	function setInput(input: SymbolTreeInput) {
		tree.setInput(input);
	}

	locations.register(tree, context);
	calls.register(tree, context);

	return { setInput };
}
