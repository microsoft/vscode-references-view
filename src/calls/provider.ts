/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CallsModel, Call } from './model';

export class DataProvider implements vscode.TreeDataProvider<Call> {

    private readonly _emitter = new vscode.EventEmitter<Call | undefined>();
    readonly onDidChangeTreeData = this._emitter.event;

    private _model?: CallsModel;

    set model(model: CallsModel | undefined) {
        this._emitter.fire();
        this._model = model;
    }

    get model(): CallsModel | undefined {
        return this._model;
    }

    getTreeItem(element: Call): vscode.TreeItem {

        const item = new vscode.TreeItem(element.item.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = element.item.detail;
        item.resourceUri = element.item.uri; //todo@joh
        return item;
    }

    getChildren(element?: Call | undefined) {
        if (!this._model) {
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
