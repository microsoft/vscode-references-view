/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface ActiveTreeDataProviderWrapper {
	provider: Required<vscode.TreeDataProvider<any>>;
}

class TreeDataProviderDelegate implements vscode.TreeDataProvider<undefined> {

	provider?: Required<vscode.TreeDataProvider<any>>;

	private _providerListener?: vscode.Disposable;
	private _onDidChange = new vscode.EventEmitter<any>();

	readonly onDidChangeTreeData = this._onDidChange.event;

	update(provider: Required<vscode.TreeDataProvider<any>>) {

		this._providerListener?.dispose();
		this._providerListener = undefined;

		this.provider = provider;
		this._providerListener = provider.onDidChangeTreeData
			? provider.onDidChangeTreeData(this._onDidChange.fire, this._onDidChange)
			: undefined;

		this._onDidChange.fire();
	}

	getTreeItem(element: unknown): vscode.TreeItem | Thenable<vscode.TreeItem> {
		this._assertProvider();
		return this.provider.getTreeItem(element);
	}

	getChildren(parent?: unknown | undefined) {
		this._assertProvider();
		return this.provider.getChildren(parent);
	}

	getParent(element: unknown) {
		this._assertProvider();
		return this.provider.getParent(element);
	}

	private _assertProvider(): asserts this is ActiveTreeDataProviderWrapper {
		if (!this.provider) {
			throw new Error('MISSING provider');
		}
	}
}

export interface SymbolTreeInput {

	title: string;
	uri: vscode.Uri;
	position: vscode.Position;

	resolve(): {
		message: string | undefined,
		provider: Required<vscode.TreeDataProvider<unknown>>;
	};
}

export class SymbolsTree {

	readonly viewId = 'references-view.tree';

	private readonly _tree: vscode.TreeView<unknown>;
	private readonly _provider = new TreeDataProviderDelegate();

	private _sessionDisposable?: vscode.Disposable;

	constructor() {
		this._tree = vscode.window.createTreeView<unknown>(this.viewId, {
			treeDataProvider: this._provider,
			showCollapseAll: true
		});
	}

	setInput(input: SymbolTreeInput) {

		this._sessionDisposable?.dispose();
		const listener: vscode.Disposable[] = [];

		this._tree.title = input.title;
		const model = input.resolve();
		this._provider.update(model.provider);

		listener.push(model.provider.onDidChangeTreeData(() => {
			this._tree.title = input.title;
			this._tree.message = model.message;
		}));

		if (typeof ((model.provider as unknown) as vscode.Disposable).dispose === 'function') {
			listener.push((model.provider as unknown) as vscode.Disposable);
		}

		this._sessionDisposable = vscode.Disposable.from(...listener);
	}
}
