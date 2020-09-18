/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface ActiveTreeDataProviderWrapper {
	provider: Promise<Required<vscode.TreeDataProvider<any>>>;
}

class TreeDataProviderDelegate implements vscode.TreeDataProvider<undefined> {

	provider?: Promise<Required<vscode.TreeDataProvider<any>>>;

	private _sessionDispoables?: vscode.Disposable;
	private _onDidChange = new vscode.EventEmitter<any>();

	readonly onDidChangeTreeData = this._onDidChange.event;

	update(provider: Promise<Required<vscode.TreeDataProvider<any>>>) {

		this._sessionDispoables?.dispose();
		this._sessionDispoables = undefined;

		this._onDidChange.fire();

		this.provider = provider;

		provider.then(value => {
			if (this.provider === provider) {
				this._sessionDispoables = value.onDidChangeTreeData(this._onDidChange.fire, this._onDidChange);
			}
		}).catch(err => {
			this.provider = undefined;
			console.error(err);
		});
	}

	async getTreeItem(element: unknown) {
		this._assertProvider();
		return (await this.provider).getTreeItem(element);
	}

	async getChildren(parent?: unknown | undefined) {
		this._assertProvider();
		return (await this.provider).getChildren(parent);
	}

	async getParent(element: unknown) {
		this._assertProvider();
		return (await this.provider).getParent(element);
	}

	private _assertProvider(): asserts this is ActiveTreeDataProviderWrapper {
		if (!this.provider) {
			throw new Error('MISSING provider');
		}
	}
}

export interface SymbolItemNavigation<T> {
	nearest(uri: vscode.Uri, position: vscode.Position): T | undefined;
	next(from: T): T;
	previous(from: T): T;
}

export interface SymbolItemHighlights<T> {
	getEditorHighlights(item: T, uri: vscode.Uri): vscode.Range[] | undefined;
}

export interface SymbolTreeModel {
	message: string | undefined,
	provider: Required<vscode.TreeDataProvider<unknown>>;
	navigation?: SymbolItemNavigation<any>;
	highlights?: SymbolItemHighlights<any>;
}

export interface SymbolTreeInput {
	title: string;
	uri: vscode.Uri;
	position: vscode.Position;
	resolve(): Promise<SymbolTreeModel>;
}

export class SymbolsTree {

	readonly viewId = 'references-view.tree';

	private readonly _tree: vscode.TreeView<unknown>;
	private readonly _provider = new TreeDataProviderDelegate();

	private _input?: SymbolTreeInput;
	private _sessionDisposable?: vscode.Disposable;

	constructor() {
		this._tree = vscode.window.createTreeView<unknown>(this.viewId, {
			treeDataProvider: this._provider,
			showCollapseAll: true
		});
	}

	setInput(input: SymbolTreeInput) {
		this._input = input;
		this._sessionDisposable?.dispose();

		this._tree.title = input.title;
		this._tree.message = undefined;

		const model = input.resolve();

		this._provider.update(model.then(model => model.provider));

		model.then(model => {

			if (this._input !== input) {
				return;
			}

			this._tree.title = input.title;
			this._tree.message = model.message;

			const listener: vscode.Disposable[] = [];

			listener.push(model.provider.onDidChangeTreeData(() => {
				this._tree.title = input.title;
				this._tree.message = model.message;
			}));

			if (typeof ((model.provider as unknown) as vscode.Disposable).dispose === 'function') {
				listener.push((model.provider as unknown) as vscode.Disposable);
			}
			this._sessionDisposable = vscode.Disposable.from(...listener);
		});
	}
}
