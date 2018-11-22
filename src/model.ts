/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class FileItem {
    constructor(
        readonly uri: vscode.Uri,
        readonly results: Array<ReferenceItem>
    ) { }
}

export class ReferenceItem {
    constructor(
        readonly location: vscode.Location,
        readonly parent: FileItem,
    ) { }
}

export class Model {

    static async create(uri: vscode.Uri, position: vscode.Position): Promise<Model | undefined> {
        let locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position);
        if (!locations) {
            return undefined;
        }
        let items: FileItem[] = [];
        let total = locations.length;
        let last: FileItem | undefined;

        // group-by file using sort
        locations.sort(Model._compareLocations);
        for (const loc of locations) {
            if (!last || last.uri.toString() !== loc.uri.toString()) {
                last = new FileItem(loc.uri, []);
                items.push(last);
            }
            last.results.push(new ReferenceItem(loc, last));
        }
        return new Model(uri, position, items, total);
    }


    private constructor(
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        readonly items: FileItem[],
        readonly total: number
    ) {
        //
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
        for (const item of this.items) {
            if (item.uri.toString() === this.uri.toString()) {
                for (const ref of item.results) {
                    if (ref.location.range.contains(this.position)) {
                        return ref;
                    }
                }
                return undefined;
            }
        }
        return undefined;
    }

    remove(item: FileItem | ReferenceItem): FileItem | undefined {
        if (item instanceof FileItem) {
            Model._del(this.items, item);
            return undefined;

        } else if (item instanceof ReferenceItem) {
            Model._del(item.parent.results, item);
            if (item.parent.results.length === 0) {
                Model._del(this.items, item.parent);
                return undefined;
            } else {
                return item.parent;
            }
        }
    }

    move(item: FileItem | ReferenceItem, fwd: boolean): ReferenceItem | undefined {

        const delta = fwd ? +1 : -1;

        const _move = (item: FileItem): FileItem => {
            const idx = (this.items.indexOf(item) + delta + this.items.length) % this.items.length;
            return this.items[idx];
        }

        if (item instanceof FileItem) {
            if (fwd) {
                return item.results[0];
            } else {
                return Model._tail(_move(item).results);
            }
        }

        if (item instanceof ReferenceItem) {
            const idx = item.parent.results.indexOf(item) + delta;
            if (idx < 0) {
                return Model._tail(_move(item.parent).results);
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
