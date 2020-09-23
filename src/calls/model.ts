/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { del } from '../models';
import { SymbolItemHighlights, SymbolItemNavigation, SymbolTreeInput, SymbolTreeModel } from '../tree';


export class CallsTreeInput implements SymbolTreeInput {

	readonly title: string;

	constructor(
		readonly uri: vscode.Uri,
		readonly position: vscode.Position,
		readonly direction: CallsDirection,
	) {
		this.title = direction === CallsDirection.Incoming
			? 'Callers Of'
			: 'Calls From';
	}

	async resolve() {

		const items = await Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', this.uri, this.position));
		const model = new CallsModel(this.direction, items ?? []);

		return <SymbolTreeModel>{
			provider: new CallItemDataProvider(model),
			message: undefined,
			navigation: model,
			highlights: model
		};
	}

	hash(): string {
		return JSON.stringify([this.uri, this.position, this.direction]);
	}
}


export const enum CallsDirection {
	Incoming,
	Outgoing
}



export class CallItem {

	children?: CallItem[];

	constructor(
		readonly item: vscode.CallHierarchyItem,
		readonly parent: CallItem | undefined,
		readonly locations: vscode.Location[] | undefined
	) { }
}

class CallsModel implements SymbolItemNavigation<CallItem>, SymbolItemHighlights<CallItem> {

	readonly source = 'callHierarchy';

	readonly roots: CallItem[] = [];

	private readonly _onDidChange = new vscode.EventEmitter<CallsModel>();
	readonly onDidChange = this._onDidChange.event;

	constructor(readonly direction: CallsDirection, items: vscode.CallHierarchyItem[]) {
		this.roots = items.map(item => new CallItem(item, undefined, undefined));
	}

	private async _resolveCalls(call: CallItem): Promise<CallItem[]> {
		if (this.direction === CallsDirection.Incoming) {
			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', call.item);
			return calls ? calls.map(item => new CallItem(item.from, call, item.fromRanges.map(range => new vscode.Location(item.from.uri, range)))) : [];
		} else {
			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', call.item);
			return calls ? calls.map(item => new CallItem(item.to, call, item.fromRanges.map(range => new vscode.Location(call.item.uri, range)))) : [];
		}
	}

	async getCallChildren(call: CallItem): Promise<CallItem[]> {
		if (!call.children) {
			call.children = await this._resolveCalls(call);
		}
		return call.children;
	}

	nearest(uri: vscode.Uri, _position: vscode.Position): CallItem | undefined {
		return this.roots.find(item => item.item.uri.toString() === uri.toString()) ?? this.roots[0];
	}

	next(from: CallItem): CallItem {
		return this._move(from, true) ?? from;
	}

	previous(from: CallItem): CallItem {
		return this._move(from, false) ?? from;
	}

	private _move(item: CallItem, fwd: boolean) {
		const roots = this.roots;
		const array = roots.indexOf(item) ? roots : item.parent?.children;

		if (!array?.length) {
			return undefined;
		}
		const idx = array.indexOf(item);
		if (fwd) {
			return array[idx + 1 % array.length];
		} else {
			return array[idx + -1 + array.length % array.length];
		}
	}

	remove(item: CallItem) {
		const isInRoot = this.roots.includes(item);
		const siblings = isInRoot ? this.roots : item.parent?.children;
		if (siblings) {
			del(siblings, item);
			this._onDidChange.fire(this);
		}
	}

	getEditorHighlights(item: CallItem, uri: vscode.Uri): vscode.Range[] | undefined {
		return item.locations
			?.filter(loc => loc.uri.toString() === uri.toString())
			.map(loc => loc.range);
	}
}

class CallItemDataProvider implements vscode.TreeDataProvider<CallItem> {

	private readonly _emitter = new vscode.EventEmitter<CallItem | undefined>();
	readonly onDidChangeTreeData = this._emitter.event;

	private readonly _modelListener: vscode.Disposable;

	constructor(
		private _model: CallsModel
	) {
		this._modelListener = _model.onDidChange(e => this._emitter.fire(e instanceof CallItem ? e : undefined));
	}

	dispose(): void {
		this._emitter.dispose();
		this._modelListener.dispose();
	}

	getTreeItem(element: CallItem): vscode.TreeItem {

		const item = new vscode.TreeItem(element.item.name);
		item.description = element.item.detail;
		item.contextValue = 'call-item';
		item.iconPath = CallItemDataProvider._getThemeIcon(element.item.kind);
		item.command = { command: 'references-view.showCallItem', title: 'Open Call', arguments: [element] };
		item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
		return item;
	}

	getChildren(element?: CallItem | undefined) {
		return element
			? this._model.getCallChildren(element)
			: this._model.roots;
	}

	getParent(element: CallItem) {
		return element.parent;
	}

	// vscode.SymbolKind.File === 0, Module === 1, etc...
	private static _themeIconIds = [
		'symbol-file', 'symbol-module', 'symbol-namespace', 'symbol-package', 'symbol-class', 'symbol-method',
		'symbol-property', 'symbol-field', 'symbol-constructor', 'symbol-enum', 'symbol-interface',
		'symbol-function', 'symbol-variable', 'symbol-constant', 'symbol-string', 'symbol-number', 'symbol-boolean',
		'symbol-array', 'symbol-object', 'symbol-key', 'symbol-null', 'symbol-enum-member', 'symbol-struct',
		'symbol-event', 'symbol-operator', 'symbol-type-parameter'
	];

	private static _getThemeIcon(kind: vscode.SymbolKind): vscode.ThemeIcon | undefined {
		let id = CallItemDataProvider._themeIconIds[kind];
		return id && new vscode.ThemeIcon(id);
	}
}
