/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolTreeInput } from './api';
import { EditorHighlights } from './highlights';
import { WordAnchor } from './history';
import { ContextKey } from './models';

export class SymbolsTree {

	readonly viewId = 'references-view.tree';

	private readonly _ctxIsActive = new ContextKey<boolean>('reference-list.isActive');
	private readonly _ctxHasResult = new ContextKey<boolean>('reference-list.hasResult');
	private readonly _ctxInputSource = new ContextKey<string>('reference-list.source');

	private readonly _history = new TreeInputHistory(this);
	private readonly _provider = new TreeDataProviderDelegate();
	private readonly _tree: vscode.TreeView<unknown>;

	private _input?: SymbolTreeInput;
	private _sessionDisposable?: vscode.Disposable;

	constructor() {
		this._tree = vscode.window.createTreeView<unknown>(this.viewId, {
			treeDataProvider: this._provider,
			showCollapseAll: true
		});
	}

	dispose(): void {
		this._history.dispose();
		this._tree.dispose();
		this._sessionDisposable?.dispose();
	}

	getInput(): SymbolTreeInput | undefined {
		return this._input;
	}

	async setInput(input: SymbolTreeInput) {

		this._ctxInputSource.set(input.contextValue);
		this._ctxIsActive.set(true);
		this._ctxHasResult.set(true);
		vscode.commands.executeCommand(`${this.viewId}.focus`);

		const newInputKind = !this._input || Object.getPrototypeOf(this._input) !== Object.getPrototypeOf(input);
		this._input = input;
		this._sessionDisposable?.dispose();

		this._tree.title = input.title;
		this._tree.message = newInputKind ? undefined : this._tree.message;

		const modelPromise = input.resolve();

		// set promise to tree data provider to trigger tree loading UI
		this._provider.update(modelPromise.then(model => model.provider));

		const model = await modelPromise;
		if (this._input !== input) {
			return;
		}

		if (model.empty) {
			this.clearInput();
			this._tree.message = this._history.size === 0 ? 'No results.' : 'No results. Try running a previous search again:';
			return;
		}

		this._history.add(input);
		this._tree.message = model.message;

		// reveal & select
		const selection = model.navigation?.nearest(input.uri, input.position);
		if (selection && this._tree.visible) {
			this._tree.reveal(selection, { select: true, focus: true, expand: true });
		}

		const disposables: vscode.Disposable[] = [];

		// editor highlights
		let highlights: EditorHighlights<unknown> | undefined;
		if (model.highlights) {
			highlights = new EditorHighlights(this._tree, model.highlights);
			highlights.update();
			disposables.push(highlights);
		}

		// listener
		disposables.push(model.provider.onDidChangeTreeData(() => {
			this._tree.title = input.title;
			this._tree.message = model.message;
			highlights?.update();
		}));

		if (typeof ((model.provider as unknown) as vscode.Disposable).dispose === 'function') {
			disposables.push((model.provider as unknown) as vscode.Disposable);
		}
		this._sessionDisposable = vscode.Disposable.from(...disposables);
	}

	clearInput(): void {
		this._sessionDisposable?.dispose();
		this._input = undefined;
		this._ctxHasResult.set(false);
		this._ctxInputSource.reset();
		this._tree.title = 'References';
		this._tree.message = undefined;
		this._provider.update(Promise.resolve(this._history));
		if (this._history.size === 0) {
			this._tree.message = 'No results.';
		}
	}
}

// --- tree data

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

// --- history

class HistoryItem {
	constructor(
		readonly word: string,
		readonly anchor: WordAnchor,
		readonly input: SymbolTreeInput,
	) { }
}

class TreeInputHistory implements vscode.TreeDataProvider<HistoryItem>{

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<HistoryItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _ctxHasHistory = new ContextKey<boolean>('reference-list.hasHistory');
	private readonly _inputs = new Map<string, Thenable<HistoryItem>>();

	constructor(private readonly _tree: SymbolsTree) {

		this._disposables.push(
			vscode.commands.registerCommand('references-view.clear', () => _tree.clearInput()),
			vscode.commands.registerCommand('references-view.clearHistory', () => {
				this.clear();
				_tree.clearInput();
			}),
			vscode.commands.registerCommand('references-view.refind', (item) => {
				if (item instanceof HistoryItem) {
					this._reRunHistoryItem(item);
				}
			}),
			vscode.commands.registerCommand('references-view.refresh', async () => {
				const input = this._tree.getInput();
				const item = this._inputs.get(input?.hash ?? '');
				if (item) {
					this._reRunHistoryItem(await item);
				}
			}),
			vscode.commands.registerCommand('_references-view.showHistoryItem', (item) => {
				if (item instanceof HistoryItem) {
					const position = item.anchor.getPosition() ?? item.input.position;
					return vscode.commands.executeCommand('vscode.open', item.input.uri, { selection: new vscode.Range(position, position) });
				}
			})
		);
	}

	dispose(): void {
		vscode.Disposable.from(...this._disposables).dispose();
		this._onDidChangeTreeData.dispose();
	}

	private _reRunHistoryItem(item: HistoryItem): void {
		this._inputs.delete(item.input.hash);
		const newInput = item.input.with(item.anchor.getPosition() ?? item.input.position);
		this._tree.setInput(newInput);
	}

	add(input: SymbolTreeInput): void {

		const p = vscode.workspace.openTextDocument(input.uri).then(doc => {
			const anchor = new WordAnchor(doc, input.position);
			const range = doc.getWordRangeAtPosition(input.position) ?? doc.getWordRangeAtPosition(input.position, /[^\s]+/);
			const word = range ? doc.getText(range) : '???';
			return new HistoryItem(word, anchor, input);
		});

		// use filo-ordering of native maps
		const key = input.hash;
		this._inputs.delete(key);
		this._inputs.set(key, p);
		this._ctxHasHistory.set(true);
	}

	clear(): void {
		this._inputs.clear();
		this._ctxHasHistory.set(false);
		this._onDidChangeTreeData.fire(undefined);
	}

	get size() {
		return this._inputs.size;
	}

	// --- tree data provider

	getTreeItem(element: HistoryItem): vscode.TreeItem {
		const result = new vscode.TreeItem(element.word);
		result.description = `${vscode.workspace.asRelativePath(element.input.uri)} • ${element.input.title.toLocaleLowerCase()}`;
		// result.command = { command: 'references-view.SHOW', arguments: [element], title: 'Rerun' };
		result.collapsibleState = vscode.TreeItemCollapsibleState.None;
		result.contextValue = 'history-item';
		return result;
	}

	getChildren() {
		return Promise.all([...this._inputs.values()].reverse());
	}

	getParent() {
		return undefined;
	}
}
