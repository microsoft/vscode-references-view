/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HistoryItem } from './history';

export function getPreviewChunks(doc: vscode.TextDocument, range: vscode.Range, beforeLen: number = 8, trim: boolean = true) {
    let previewStart = range.start.with({ character: Math.max(0, range.start.character - beforeLen) });
    let wordRange = doc.getWordRangeAtPosition(previewStart);
    let before = doc.getText(new vscode.Range(wordRange ? wordRange.start : previewStart, range.start));
    let inside = doc.getText(range);
    let previewEnd = range.end.translate(0, 331);
    let after = doc.getText(new vscode.Range(range.end, previewEnd));
    if (trim) {
        before = before.replace(/^\s*/g, '');
        after = after.replace(/\s*$/g, '');
    }
    return { before, inside, after };
}

export const enum ItemSource {
    References = 'vscode.executeReferenceProvider',
    Implementations = 'vscode.executeImplementationProvider',
    CallHierarchy = 'vscode.prepareCallHierarchy'
}


//#region References Model


export class FileItem {

    private _document: Thenable<vscode.TextDocument> | undefined;

    constructor(
        readonly uri: vscode.Uri,
        readonly results: Array<ReferenceItem>,
        readonly parent: ReferencesModel
    ) { }

    getDocument(warmUpNext?: boolean): Thenable<vscode.TextDocument> {
        if (!this._document) {
            this._document = vscode.workspace.openTextDocument(this.uri);
        }
        if (warmUpNext) {
            // load next document once this document has been loaded
            // and when next document has not yet been loaded
            const item = this.parent.move(this, true);
            if (item && !item.parent._document) {
                this._document.then(() => item.parent.getDocument(false));
            }
        }
        return this._document;
    }
}

export class ReferenceItem {
    constructor(
        readonly location: vscode.Location,
        readonly parent: FileItem,
    ) { }
}

export class ReferencesModel {

    static async create(uri: vscode.Uri, position: vscode.Position, source: ItemSource): Promise<ReferencesModel | undefined> {
        let locations = await vscode.commands.executeCommand<vscode.Location[]>(source, uri, position);
        if (!locations) {
            return undefined;
        }
        return new ReferencesModel(source, uri, position, locations);
    }

    private readonly _onDidChange = new vscode.EventEmitter<ReferencesModel | FileItem>();
    readonly onDidChange = this._onDidChange.event;

    readonly items: FileItem[];

    constructor(
        readonly source: ItemSource,
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        locations: vscode.Location[]
    ) {
        this.items = [];
        let last: FileItem | undefined;
        locations.sort(ReferencesModel._compareLocations);
        for (const loc of locations) {
            if (!last || last.uri.toString() !== loc.uri.toString()) {
                last = new FileItem(loc.uri, [], this);
                this.items.push(last);
            }
            last.results.push(new ReferenceItem(loc, last));
        }
    }

    async asHistoryItem(args: any[]) {
        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument(this.uri);
        } catch (e) {
            return;
        }
        const range = doc.getWordRangeAtPosition(this.position);
        if (!range) {
            return;
        }
        // make preview
        let { before, inside, after } = getPreviewChunks(doc, range);
        // ensure whitespace isn't trimmed when rendering MD
        before = before.replace(/s$/g, String.fromCharCode(160));
        after = after.replace(/^s/g, String.fromCharCode(160));
        let preview = before + inside + after;

        // source hint
        let source = this.source === ItemSource.Implementations ? 'implementations' : 'references';

        return new HistoryItem(
            HistoryItem.makeId(this.source, this.uri, this.position),
            inside,
            `${vscode.workspace.asRelativePath(this.uri)} • ${preview} • ${source}`,
            { arguments: args, title: '', command: 'references-view.refindReference' },
            this.uri,
            this.position
        );
    }

    get total(): number {
        let n = 0;
        for (const item of this.items) {
            n += item.results.length;
        }
        return n;
    }

    get(uri: vscode.Uri): FileItem | undefined {
        for (const item of this.items) {
            if (item.uri.toString() === uri.toString()) {
                return item;
            }
        }
        return undefined;
    }

    first(): ReferenceItem | undefined {
        if (this.items.length === 0) {
            return;
        }
        // NOTE: this.items is sorted by location (uri/range)
        for (const item of this.items) {
            if (item.uri.toString() === this.uri.toString()) {
                // (1) pick the item at the request position
                for (const ref of item.results) {
                    if (ref.location.range.contains(this.position)) {
                        return ref;
                    }
                }
                // (2) pick the first item after or last before the request position
                let lastBefore: ReferenceItem | undefined;
                for (const ref of item.results) {
                    if (ref.location.range.end.isAfter(this.position)) {
                        return ref;
                    }
                    lastBefore = ref;
                }
                if (lastBefore) {
                    return lastBefore;
                }

                break;
            }
        }

        // (3) pick the file with the longest common prefix
        let best = 0;
        let bestValue = ReferencesModel._prefixLen(this.items[best].toString(), this.uri.toString());

        for (let i = 1; i < this.items.length; i++) {
            let value = ReferencesModel._prefixLen(this.items[i].uri.toString(), this.uri.toString());
            if (value > bestValue) {
                best = i;
            }
        }

        return this.items[best].results[0];
    }

    remove(item: FileItem | ReferenceItem): void {

        if (item instanceof FileItem) {
            ReferencesModel._del(this.items, item);
            this._onDidChange.fire(this);

        } else if (item instanceof ReferenceItem) {
            ReferencesModel._del(item.parent.results, item);
            if (item.parent.results.length === 0) {
                ReferencesModel._del(this.items, item.parent);
                this._onDidChange.fire(this);
            } else {
                this._onDidChange.fire(item.parent);
            }
        }
    }

    move(item: FileItem | ReferenceItem, fwd: boolean): ReferenceItem | undefined {

        const delta = fwd ? +1 : -1;

        const _move = (item: FileItem): FileItem => {
            const idx = (this.items.indexOf(item) + delta + this.items.length) % this.items.length;
            return this.items[idx];
        };

        if (item instanceof FileItem) {
            if (fwd) {
                return _move(item).results[0];
            } else {
                return ReferencesModel._tail(_move(item).results);
            }
        }

        if (item instanceof ReferenceItem) {
            const idx = item.parent.results.indexOf(item) + delta;
            if (idx < 0) {
                return ReferencesModel._tail(_move(item.parent).results);
            } else if (idx >= item.parent.results.length) {
                return _move(item.parent).results[0];
            } else {
                return item.parent.results[idx];
            }
        }
    }

    private static _compareLocations(a: vscode.Location, b: vscode.Location): number {
        if (a.uri.toString() < b.uri.toString()) {
            return -1;
        } else if (a.uri.toString() > b.uri.toString()) {
            return 1;
        } else if (a.range.start.isBefore(b.range.start)) {
            return -1;
        } else if (a.range.start.isAfter(b.range.start)) {
            return 1;
        } else {
            return 0;
        }
    }

    private static _prefixLen(a: string, b: string): number {
        let pos = 0;
        while (pos < a.length && pos < b.length && a.charCodeAt(pos) === b.charCodeAt(pos)) {
            pos += 1;
        }
        return pos;
    }

    private static _del<T>(array: T[], e: T): void {
        const idx = array.indexOf(e);
        if (idx >= 0) {
            array.splice(idx, 1);
        }
    }

    private static _tail<T>(array: T[]): T | undefined {
        return array[array.length - 1];
    }
}


//#endregion

//#region CallHierarchy Model

export const enum CallsDirection {
    Incoming,
    Outgoing
}


export class RichCallsDirection {

    private static _key = 'calls-view.mode';

    constructor(
        private _mem: vscode.Memento,
        private _value: CallsDirection = CallsDirection.Incoming,
    ) {
        const raw = _mem.get<number>(RichCallsDirection._key);
        if (typeof raw === 'number' && raw >= 0 && raw <= 1) {
            this.value = raw;
        } else {
            this.value = _value;
        }
    }

    get value() {
        return this._value;
    }

    set value(value: CallsDirection) {
        this._value = value;
        vscode.commands.executeCommand('setContext', 'references-view.callHierarchyMode', this._value === CallsDirection.Incoming ? 'showIncoming' : 'showOutgoing');
        this._mem.update(RichCallsDirection._key, value);
    }
}

export class CallItem {
    constructor(
        readonly item: vscode.CallHierarchyItem,
        readonly parent: CallItem | undefined,
        readonly locations: vscode.Location[] | undefined
    ) { }
}

export class CallsModel {

    readonly roots: Promise<CallItem[]>;

    constructor(readonly uri: vscode.Uri, readonly position: vscode.Position, readonly direction: CallsDirection) {
        this.roots = Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position)).then(items => {
            return items ? items.map(item => new CallItem(item, undefined, undefined)) : [];
        });
    }

    async resolveCalls(call: CallItem): Promise<CallItem[]> {
        if (this.direction === CallsDirection.Incoming) {
            const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', call.item);
            return calls ? calls.map(item => new CallItem(item.from, call, item.fromRanges.map(range => new vscode.Location(item.from.uri, range)))) : [];
        } else {
            const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', call.item);
            return calls ? calls.map(item => new CallItem(item.to, call, item.fromRanges.map(range => new vscode.Location(call.item.uri, range)))) : [];
        }
    }

    changeDirection(): CallsModel {
        return new CallsModel(this.uri, this.position, this.direction === CallsDirection.Incoming ? CallsDirection.Outgoing : CallsDirection.Incoming);
    }

    async asHistoryItem(args: any[]) {

        const [first] = await this.roots;
        const source = this.direction === CallsDirection.Incoming ? 'calls from' : 'callers of';

        return new HistoryItem(
            HistoryItem.makeId(first.item.uri, first.item.selectionRange.start.line, first.item.selectionRange.start.character, this.direction),
            first.item.name,
            `${vscode.workspace.asRelativePath(this.uri)}  • ${source}`,
            { arguments: args, title: '', command: 'references-view.showCallHierarchy' },
            this.uri,
            this.position
        );
    }
}

//#endregion
