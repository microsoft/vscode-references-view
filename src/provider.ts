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

    private _modelListener?: vscode.Disposable;
    private _disposed = false;

    constructor(
        private _modelCreation: Promise<ReferencesModel | undefined>
    ) {
        _modelCreation.then(model => {
            if (model && !this._disposed) {
                this._modelListener = model.onDidChange(e => this._onDidChangeTreeData.fire(e instanceof FileItem ? e : undefined));
            }
        });
    }

    dispose(): void {
        this._disposed = true;
        this._onDidChangeTreeData.dispose();
        if (this._modelListener) {
            this._modelListener.dispose();
        }
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
            const doc = await element.parent.getDocument(true);
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
        if (element instanceof FileItem) {
            return element.results;
        } else if (this._modelCreation) {
            const model = await this._modelCreation;
            return model?.items;
        }
    }

    getParent(element: FileItem | ReferenceItem) {
        return element instanceof ReferenceItem ? element.parent : undefined;
    }
}

export class CallItemDataProvider implements vscode.TreeDataProvider<CallHierarchyItem> {

    private readonly _emitter = new vscode.EventEmitter<CallHierarchyItem | undefined>();
    readonly onDidChangeTreeData = this._emitter.event;

    constructor(
        private _model: CallsModel
    ) { }

    getTreeItem(element: CallHierarchyItem): vscode.TreeItem {

        const item = new vscode.TreeItem(element.item.name);
        item.description = element.item.detail;
        item.contextValue = 'call-item';
        // item.iconPath = vscode.Uri.parse('vscode-icon://codicon/zap'); // todo@joh
        item.command = { command: 'references-view.show', title: 'Open Call', arguments: [element] };
        item.collapsibleState = element.locations
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.Expanded; // root item
        return item;
    }

    getChildren(element?: CallHierarchyItem | undefined) {
        if (!element) {
            return this._model.roots;
        } else {
            return this._model.resolveCalls(element);
        }
    }

    getParent(element: CallHierarchyItem) {
        return element.parent;
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


export type TreeItem = FileItem | ReferenceItem | HistoryItem | CallHierarchyItem;

export class TreeDataProviderWrapper<T> implements vscode.TreeDataProvider<T> {

    private _provider?: Required<vscode.TreeDataProvider<T>>;
    private _providerListener?: vscode.Disposable;
    private _onDidChange = new vscode.EventEmitter<T | undefined | null>();

    readonly onDidChangeTreeData = this._onDidChange.event;

    update(provider: Required<vscode.TreeDataProvider<T>>) {
        if (this._providerListener) {
            this._providerListener.dispose();
            this._providerListener = undefined;
        }
        this._provider = provider;
        this._onDidChange.fire();
        this._providerListener = this._provider.onDidChangeTreeData(e => this._onDidChange.fire(e));
    }

    getTreeItem(element: T): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return this._provider!.getTreeItem(element);
    }

    getChildren(element?: T | undefined) {
        return this._provider?.getChildren(element);
    }

    getParent(element: T) {
        return this._provider?.getParent(element);
    }
}
