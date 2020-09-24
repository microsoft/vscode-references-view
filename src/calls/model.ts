/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolItemEditorHighlights, SymbolItemNavigation, SymbolTreeInput, SymbolTreeModel } from '../api';
import { del, tail } from '../models';


export class CallsTreeInput implements SymbolTreeInput {

	readonly title: string;
	readonly contextValue: string = 'callHierarchy';
	readonly hash: string;

	constructor(
		readonly uri: vscode.Uri,
		readonly position: vscode.Position,
		readonly direction: CallsDirection,
	) {
		this.title = direction === CallsDirection.Incoming
			? 'Callers Of'
			: 'Calls From';
		this.hash = JSON.stringify([this.uri, this.position, this.direction]);
	}

	async resolve() {

		const items = await Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', this.uri, this.position));
		const model = new CallsModel(this.direction, items ?? []);
		const provider = new CallItemDataProvider(model);

		return <SymbolTreeModel>{
			provider,
			get message() { return model.roots.length === 0 ? 'No results.' : undefined; },
			empty: model.roots.length === 0,
			navigation: model,
			highlights: model,
			dispose() {
				provider.dispose();
			}
		};
	}

	with(position: vscode.Position): CallsTreeInput {
		return new CallsTreeInput(this.uri, position, this.direction);
	}
}


export const enum CallsDirection {
	Incoming,
	Outgoing
}



export class CallItem {

	children?: CallItem[];

	constructor(
		private readonly _model: CallsModel,
		readonly item: vscode.CallHierarchyItem,
		readonly parent: CallItem | undefined,
		readonly locations: vscode.Location[] | undefined
	) { }

	remove(): void {
		this._model.remove(this);
	}
}

class CallsModel implements SymbolItemNavigation<CallItem>, SymbolItemEditorHighlights<CallItem> {

	readonly source = 'callHierarchy';

	readonly roots: CallItem[] = [];

	private readonly _onDidChange = new vscode.EventEmitter<CallsModel>();
	readonly onDidChange = this._onDidChange.event;

	constructor(readonly direction: CallsDirection, items: vscode.CallHierarchyItem[]) {
		this.roots = items.map(item => new CallItem(this, item, undefined, undefined));
	}

	private async _resolveCalls(call: CallItem): Promise<CallItem[]> {
		if (this.direction === CallsDirection.Incoming) {
			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', call.item);
			return calls ? calls.map(item => new CallItem(this, item.from, call, item.fromRanges.map(range => new vscode.Location(item.from.uri, range)))) : [];
		} else {
			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', call.item);
			return calls ? calls.map(item => new CallItem(this, item.to, call, item.fromRanges.map(range => new vscode.Location(call.item.uri, range)))) : [];
		}
	}

	async getCallChildren(call: CallItem): Promise<CallItem[]> {
		if (!call.children) {
			call.children = await this._resolveCalls(call);
		}
		return call.children;
	}

	// -- navigation 

	location(item: CallItem) {
		return new vscode.Location(item.item.uri, item.item.range);
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
		if (item.children?.length) {
			return fwd ? item.children[0] : tail(item.children);
		}
		const array = this.roots.includes(item) ? this.roots : item.parent?.children;
		if (array?.length) {
			const idx = array.indexOf(item);
			const delta = fwd ? 1 : -1;
			return array[idx + delta + array.length % array.length];
		}
	}

	// --- highlights

	getEditorHighlights(item: CallItem, uri: vscode.Uri): vscode.Range[] | undefined {
		return item.locations
			?.filter(loc => loc.uri.toString() === uri.toString())
			.map(loc => loc.range);
	}

	remove(item: CallItem) {
		const isInRoot = this.roots.includes(item);
		const siblings = isInRoot ? this.roots : item.parent?.children;
		if (siblings) {
			del(siblings, item);
			this._onDidChange.fire(this);
		}
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
