/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Context } from './utils';

export class WordAnchor {

    private readonly _version: number;
    private readonly _word: string | undefined;

    constructor(private readonly _doc: vscode.TextDocument, private readonly _position: vscode.Position) {
        this._version = _doc.version;
        this._word = this._getAnchorWord(_doc, _position);
    }

    private _getAnchorWord(doc: vscode.TextDocument, pos: vscode.Position): string | undefined {
        const range = doc.getWordRangeAtPosition(pos) || doc.getWordRangeAtPosition(pos, /[^\s]+/);
        return range && doc.getText(range);
    }

    getPosition(): vscode.Position | undefined {
        // funky entry
        if (!this._word) {
            return this._position;
        }

        // no changes
        if (this._version === this._doc.version) {
            return this._position;
        }

        // no changes here...
        const wordNow = this._getAnchorWord(this._doc, this._position);
        if (this._word === wordNow) {
            return this._position;
        }

        // changes: search _word downwards and upwards
        const startLine = this._position.line;
        let i = 0;
        let line: number;
        let checked: boolean;
        do {
            checked = false;
            // nth line down
            line = startLine + i;
            if (line < this._doc.lineCount) {
                checked = true;
                let ch = this._doc.lineAt(line).text.indexOf(this._word);
                if (ch >= 0) {
                    return new vscode.Position(line, ch);
                }
            }
            i += 1;
            // nth line up
            line = startLine - i;
            if (line >= 0) {
                checked = true;
                let ch = this._doc.lineAt(line).text.indexOf(this._word);
                if (ch >= 0) {
                    return new vscode.Position(line, ch);
                }
            }
        } while (i < 100 && checked);

        // fallback
        return this._position;
    }
}

export class HistoryItem {

    static makeId(...args: any[]): string {
        let str = '';
        for (const a of args) {
            str += JSON.stringify(a);
        }
        return str;
    }

    constructor(
        readonly id: string,
        readonly label: string,
        readonly description: string,
        readonly commandId: string,
        readonly extraArgs: string[],
        readonly uri: vscode.Uri,
        readonly anchor: WordAnchor,
    ) { }
}

export class History {

    private readonly _items = new Map<string, HistoryItem>();

    get isEmpty(): boolean {
        return this._items.size === 0;
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
            Context.HasHistory.set(true);
        }
    }

    get(id: string): HistoryItem | undefined {
        return this._items.get(id);
    }

    clear(): void {
        this._items.clear();
        Context.HasHistory.set(false);
    }
}
