/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class HistoryItem {

    static makeId(...args: any[]): string {
        let str = '';
        for (const a of args) {
            str += JSON.stringify(a);
        }
        return Buffer.from(str).toString('base64');
    }

    constructor(
        readonly id: string,
        readonly label: string,
        readonly description: string,
        readonly command: vscode.Command,
        readonly uri: vscode.Uri,
        readonly position: vscode.Position
    ) { }
}

export class History {

    private readonly _items = new Map<string, HistoryItem>();

    get isEmpty(): boolean {
        return this._items.size == 0;
    }

    *[Symbol.iterator]() {
        let values = [...this._items.values()];
        for (let i = values.length - 1; i >= 0; i--) {
            yield values[i];
        }
    }

    add(item?: HistoryItem): void {
        if (item) {
            // maps have filo-ordering and by delete-insert we make
            // sure to update the order for re-run queries
            this._items.delete(item.id);
            this._items.set(item.id, item);
            vscode.commands.executeCommand('setContext', 'reference-list.hasHistory', true);
        }
    }

    get(id: string): HistoryItem | undefined {
        return this._items.get(id);
    }

    clear(): void {
        this._items.clear();
        vscode.commands.executeCommand('setContext', 'reference-list.hasHistory', false);
    }
}
