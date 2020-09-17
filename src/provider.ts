/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { History, HistoryItem } from './history';
import { CallItem as CallHierarchyItem, CallsModel, FileItem, getPreviewChunks, ReferenceItem, ReferencesModel } from './models';

export class ReferencesProvider implements vscode.TreeDataProvider<FileItem | ReferenceItem> {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<FileItem | ReferenceItem>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly _modelListener: vscode.Disposable;

    constructor(
        private _model: ReferencesModel
    ) {
        this._modelListener = _model.onDidChange(e => this._onDidChangeTreeData.fire(e instanceof FileItem ? e : undefined));
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this._modelListener.dispose();
    }

    async getTreeItem(element: FileItem | ReferenceItem): Promise<vscode.TreeItem> {

        if (element instanceof FileItem) {
            // files
            const result = new vscode.TreeItem(element.uri);
            result.contextValue = 'file-item';
            result.description = true;
            result.iconPath = vscode.ThemeIcon.File;
            result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            return result;

        } else {
            // references
            const { range } = element.location;
            const doc = await element.getDocument(true);
            const { before, inside, after } = getPreviewChunks(doc, range);

            const label: vscode.TreeItemLabel = {
                label: before + inside + after,
                highlights: [[before.length, before.length + inside.length]]
            };

            const result = new vscode.TreeItem2(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.contextValue = 'reference-item';
            result.command = { command: 'references-view.show', title: 'Open Reference', arguments: [element] };
            return result;
        }
    }

    async getChildren(element?: FileItem | ReferenceItem | undefined) {
        if (!element) {
            // group results by FileItem
            return this._model.items;
        } else if (element instanceof FileItem) {
            // matches inside a file
            return element.results;
        }
    }

    getParent(element: FileItem | ReferenceItem) {
        return element instanceof ReferenceItem ? element.parent : undefined;
    }
}

export class CallItemDataProvider implements vscode.TreeDataProvider<CallHierarchyItem> {

    private readonly _emitter = new vscode.EventEmitter<CallHierarchyItem | undefined>();
    readonly onDidChangeTreeData = this._emitter.event;

    private readonly _modelListener: vscode.Disposable;

    constructor(
        private _model: CallsModel
    ) {
        this._modelListener = _model.onDidChange(e => this._emitter.fire(e instanceof CallHierarchyItem ? e : undefined));
    }

    dispose(): void {
        this._emitter.dispose();
        this._modelListener.dispose();
    }

    getTreeItem(element: CallHierarchyItem): vscode.TreeItem {

        const item = new vscode.TreeItem(element.item.name);
        item.description = element.item.detail;
        item.contextValue = 'call-item';
        item.iconPath = CallItemDataProvider._getThemeIcon(element.item.kind);
        item.command = { command: 'references-view.show', title: 'Open Call', arguments: [element] };
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        return item;
    }

    getChildren(element?: CallHierarchyItem | undefined) {
        return element
            ? this._model.getCallChildren(element)
            : this._model.roots;
    }

    getParent(element: CallHierarchyItem) {
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

export class HistoryDataProvider implements vscode.TreeDataProvider<HistoryItem> {

    private readonly _emitter = new vscode.EventEmitter<HistoryItem | undefined>();
    readonly onDidChangeTreeData = this._emitter.event;

    constructor(private readonly _history: History) { }

    getTreeItem(element: HistoryItem): vscode.TreeItem {
        // history items
        // let source: string | undefined;
        // if (element.source === ItemSource.References) {
        //     source = 'references';
        // } else if (element.source === ItemSource.Implementations) {
        //     source = 'implementations';
        // } else if (element.source === ItemSource.CallHierarchy) {
        //     source = 'call hierarchy';
        // }
        const result = new vscode.TreeItem(element.label);
        // result.description = `${vscode.workspace.asRelativePath(element.uri)} • ${element.line} ${source && ` • ${source}`}`;
        result.description = element.description;
        result.command = { command: 'references-view.show', arguments: [element], title: 'Show' };
        result.collapsibleState = vscode.TreeItemCollapsibleState.None;
        result.contextValue = 'history-item';
        return result;
    }

    getChildren() {
        return [...this._history];
    }

    getParent() {
        return undefined;
    }
}

interface ActiveTreeDataProviderWrapper {
    provider: Required<vscode.TreeDataProvider<any>>;
}

export class TreeDataProviderWrapper implements vscode.TreeDataProvider<undefined> {

    provider?: Required<vscode.TreeDataProvider<any>>;

    private _providerListener?: vscode.Disposable;
    private _onDidChange = new vscode.EventEmitter<any>();

    readonly onDidChangeTreeData = this._onDidChange.event;

    update(provider: Required<vscode.TreeDataProvider<any>>) {

        this._providerListener?.dispose();
        this._providerListener = undefined;

        if (this.provider && typeof (<vscode.Disposable><any>this.provider).dispose === 'function') {
            (<vscode.Disposable><any>this.provider).dispose();

        }

        this.provider = provider;
        if (provider.onDidChangeTreeData) {
            this._providerListener = provider.onDidChangeTreeData(this._onDidChange.fire, this._onDidChange);
        }
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
