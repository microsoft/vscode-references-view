/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Model } from './model';
import { getPreviewChunks } from './provider';


export class HistoryItem {
    constructor(
        readonly id: string,
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        readonly preview: string,
        readonly word: string,
        readonly line: string,
    ) { }

    get kind(): 'historyItem' {
        return 'historyItem';
    }
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

    async add({ uri, position }: Model): Promise<void> {

        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument(uri);
        } catch (e) {
            return;
        }

        const range = doc.getWordRangeAtPosition(position);
        if (!range) {
            return;
        }

        const id = History._makeId(uri, range.start);

        // make preview
        let { before, inside, after } = getPreviewChunks(doc, range);
        // ensure whitespace isn't trimmed when rendering MD
        before = before.replace(/s$/g, String.fromCharCode(160));
        after = after.replace(/^s/g, String.fromCharCode(160));
        // make command link
        let query = encodeURIComponent(JSON.stringify([id]));
        let title = `${vscode.workspace.asRelativePath(uri)}:${position.line + 1}:${position.character + 1}`;
        let mdInside = `[${inside}](command:references-view.refind?${query} "${title}")`;

        // maps have filo-ordering and by delete-insert we make
        // sure to update the order for re-run queries
        this._items.delete(id);
        this._items.set(id, new HistoryItem(
            id,
            uri,
            position,
            before + mdInside + after,
            inside,
            before + inside + after
        ));
    }

    get(id: string): HistoryItem | undefined {
        return this._items.get(id);
    }

    clear(): void {
        this._items.clear();
    }

    private static _makeId(uri: vscode.Uri, position: vscode.Position): string {
        return Buffer.from(uri.toString() + position.line + position.character).toString('base64');
    }
}
