/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Model } from './model';
import { getPreviewChunks } from './provider';


export interface HistoryItem {
    id: string;
    preview: string;
    uri: vscode.Uri,
    position: vscode.Position;
}

export class History {

    private readonly _items = new Map<string, HistoryItem>();

    get summary(): string {
        let val = '';
        for (const item of this) {
            val += `* ${item.preview}\n`;
        }
        return val;
    }

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
        inside = `[${inside}](command:references-view.refind?${query} "${title}")`;
        const preview = before + inside + after

        // maps have filo-ordering and by delete-insert we make
        // sure to update the order for re-run queries
        this._items.delete(id);
        this._items.set(id, { id, preview, uri, position });
    }

    get(id: string): HistoryItem | undefined {
        return this._items.get(id);
    }

    private static _makeId(uri: vscode.Uri, position: vscode.Position): string {
        return Buffer.from(uri.toString() + position.line + position.character).toString('base64');
    }
}
