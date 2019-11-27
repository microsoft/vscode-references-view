/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CallsModel, Call } from './model';
import { History, HistoryItem } from './history';

export type TreeObject = Call | HistoryItem;

export class DataProvider implements vscode.TreeDataProvider<TreeObject> {

    private readonly _emitter = new vscode.EventEmitter<TreeObject | undefined>();
    readonly onDidChangeTreeData = this._emitter.event;

    private _model?: CallsModel;
    private _history: History;

    constructor(history: History) {
        this._history = history;
    }

    set model(model: CallsModel | undefined) {
        this._emitter.fire();
        this._model = model;
    }

    get model(): CallsModel | undefined {
        return this._model;
    }

    getTreeItem(element: TreeObject): vscode.TreeItem {

        if (element instanceof Call) {
            const item = new vscode.TreeItem(element.item.name, vscode.TreeItemCollapsibleState.Collapsed);
            item.description = element.item.detail;
            item.contextValue = 'call-item';
            // item.resourceUri = element.item.uri; //todo@joh
            item.command = { command: 'calls-view.reveal', title: 'Open Call', arguments: [element] }
            return item;

        } else {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.description = element.detail;
            item.contextValue = 'call-history-item';
            item.command = { command: 'calls-view.reveal', title: element.label, arguments: [element] };
            return item;
        }
    }

    getChildren(element?: TreeObject | undefined) {
        if (!this._model) {
            return this._history.items
        }
        if (element instanceof HistoryItem) {
            return undefined;
        }
        if (!element) {
            return this._model.root;
        } else {
            return this._model.resolveCalls(element);
        }
    }

    getParent(element: Call) {
        return element.parent;
    }
}
