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

    async getDocument(warmUpNext?: boolean) {
        if (!this._document) {
            this._document = vscode.workspace.openTextDocument(this.uri);
        }
        if (warmUpNext) {
            // load next document once this document has been loaded
            // and when next document has not yet been loaded
            const item = await this.parent.move(this, true);
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

    static create(uri: vscode.Uri, position: vscode.Position, source: ItemSource): ReferencesModel {
        const locations = Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(source, uri, position)).then(loc => {
            if (!loc) {
                return [];
            } else {
                return loc.sort(ReferencesModel._compareLocations);
            }
        });
        return new ReferencesModel(source, uri, position, locations);
    }

    private readonly _onDidChange = new vscode.EventEmitter<ReferencesModel | FileItem>();
    readonly onDidChange = this._onDidChange.event;

    readonly items: Promise<FileItem[]>;

    constructor(
        readonly source: ItemSource,
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        locations: Promise<vscode.Location[]>
    ) {
        this.items = locations.then(locations => {
            const items: FileItem[] = [];
            let last: FileItem | undefined;
            locations.sort(ReferencesModel._compareLocations);
            for (const loc of locations) {
                if (!last || last.uri.toString() !== loc.uri.toString()) {
                    last = new FileItem(loc.uri, [], this);
                    items.push(last);
                }
                last.results.push(new ReferenceItem(loc, last));
            }
            return items;
        });
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

    async total(): Promise<number> {
        let n = 0;
        for (const item of await this.items) {
            n += item.results.length;
        }
        return n;
    }

    async get(uri: vscode.Uri): Promise<FileItem | undefined> {
        for (const item of await this.items) {
            if (item.uri.toString() === uri.toString()) {
                return item;
            }
        }
        return undefined;
    }

    async first(): Promise<ReferenceItem | undefined> {

        const items = await this.items;

        if (items.length === 0) {
            return;
        }
        // NOTE: this.items is sorted by location (uri/range)
        for (const item of items) {
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
        let bestValue = ReferencesModel._prefixLen(items[best].toString(), this.uri.toString());

        for (let i = 1; i < items.length; i++) {
            let value = ReferencesModel._prefixLen(items[i].uri.toString(), this.uri.toString());
            if (value > bestValue) {
                best = i;
            }
        }

        return items[best].results[0];
    }

    async remove(item: FileItem | ReferenceItem): Promise<void> {

        if (item instanceof FileItem) {
            ReferencesModel._del(await this.items, item);
            this._onDidChange.fire(this);

        } else if (item instanceof ReferenceItem) {
            ReferencesModel._del(item.parent.results, item);
            if (item.parent.results.length === 0) {
                ReferencesModel._del(await this.items, item.parent);
                this._onDidChange.fire(this);
            } else {
                this._onDidChange.fire(item.parent);
            }
        }
    }

    async move(item: FileItem | ReferenceItem, fwd: boolean): Promise<ReferenceItem | undefined> {
        const items = await this.items;
        const delta = fwd ? +1 : -1;

        const _move = (item: FileItem): FileItem => {
            const idx = (items.indexOf(item) + delta + items.length) % items.length;
            return items[idx];
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

    private static _key = 'references-view.callHierarchyMode';

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

    readonly source = 'callHierarchy';

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

    async isEmpty() {
        return (await this.roots).length === 0;
    }

    async first() {
        const [first] = await this.roots;
        return first;
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
