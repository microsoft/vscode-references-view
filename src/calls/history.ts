/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Call, CallsModel, CallsDirection } from './model';


export class HistoryItem {
    constructor(
        readonly id: string,
        readonly label: string,
        readonly detail: string,
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
    ) { }
}

export class History {

    private readonly _items = new Map<string, HistoryItem>()

    get items() {
        return [...this._items.values()].reverse();
    }

    add(call: Call, model: CallsModel) {
        const id = History._makeId(call, model);
        this._items.delete(id);

        const item = new HistoryItem(
            id,
            call.item.name,
            `${model.direction === CallsDirection.Incoming ? 'Callers of' : 'Calls from'} '${call.item.name}'`,
            call.item.uri,
            call.item.selectionRange.start
        );

        this._items.set(id, item);
    }

    private static _makeId(call: Call, model: CallsModel) {
        return Buffer.from(call.item.uri.toString() + call.item.selectionRange.start.line + call.item.selectionRange.start.character + model.direction).toString('base64');
    }
}
