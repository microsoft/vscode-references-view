/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ContextKey } from '../models';
import { SymbolsTree } from '../tree';
import { CallItem, CallsDirection, CallsTreeInput } from './model';

export function register(tree: SymbolsTree, context: vscode.ExtensionContext): void {

	const direction = new RichCallsDirection(context.workspaceState, CallsDirection.Incoming);

	function showCallHierarchy() {
		if (vscode.window.activeTextEditor) {
			const input = new CallsTreeInput(vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.selection.active, direction.value);
			tree.setInput(input);
		}
	};

	function setCallsDirection(value: CallsDirection) {
		direction.value = value;
		const input = tree.getInput();
		if (input instanceof CallsTreeInput) {
			const newInput = new CallsTreeInput(input.uri, input.position, direction.value);
			tree.setInput(newInput);
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('references-view.showCallHierarchy', () => showCallHierarchy()),
		vscode.commands.registerCommand('references-view.showOutgoingCalls', () => setCallsDirection(CallsDirection.Outgoing)),
		vscode.commands.registerCommand('references-view.showIncomingCalls', () => setCallsDirection(CallsDirection.Incoming)),
		vscode.commands.registerCommand('references-view.showCallItem', (item, preserveFocus?: boolean) => {
			if (item instanceof CallItem) {
				return vscode.commands.executeCommand('vscode.open', item.item.uri, {
					selection: new vscode.Range(item.item.selectionRange.start, item.item.selectionRange.start),
					preserveFocus
				});
			}
		})
	);
}

class RichCallsDirection {

	private static _key = 'references-view.callHierarchyMode';

	private _ctxMode = new ContextKey<'showIncoming' | 'showOutgoing'>('references-view.callHierarchyMode');

	constructor(
		private _mem: vscode.Memento,
		private _value: CallsDirection = CallsDirection.Outgoing,
	) {
		const raw = _mem.get<number>(RichCallsDirection._key);
		if (typeof raw === 'number' && raw >= 0 && raw <= 1) {
			this.value = raw;
		} else {
			this.value = _value;
		}
	}

	get value() {
		return this._value;
	}

	set value(value: CallsDirection) {
		this._value = value;
		this._ctxMode.set(this._value === CallsDirection.Incoming ? 'showIncoming' : 'showOutgoing');
		this._mem.update(RichCallsDirection._key, value);
	}
}
