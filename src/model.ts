/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class FolderItem {
    constructor(
        readonly name : string,
        readonly parent: Model | FolderItem,
        readonly folders: Array<FolderItem>,
        readonly files: Array<FileItem>
    ) { }

    get firstFile(): FileItem | undefined {
        if (this.folders.length > 0) {
            return this.folders[0].firstFile;
        }
        if (this.files.length > 0) {
            return this.files[0];
        }
        return undefined;
    }

    get lastFile(): FileItem | undefined {
        if (this.files.length > 0) {
            return _last(this.files);
        }
        if (this.folders.length > 0) {
            return _last(this.folders).lastFile;
        }
        return undefined;
    }

    get firstFolder(): FolderItem {
        if (this.folders.length > 0) {
            return this.folders[0];
        }
        return this;
    }

    get lastFolder(): FolderItem {
        if (this.folders.length > 0) {
            return _last(this.folders);
        }
        return this;
    }

    get nextFile(): FileItem | undefined {
        const result = this.nextSibling;
        if (result !== undefined) {
            return result.firstFolder.firstFile;
        }
        if (this.parent instanceof Model) {
            return undefined;
        } else {
            if (this.parent.files.length > 0) {
                return this.parent.files[0];
            }
            return this.parent.nextFile;
        }
    }

    get prevFile(): FileItem | undefined {
        const result = this.prevSibling;
        if (result !== undefined) {
            return result.lastFolder.lastFile;
        }
        if (this.parent instanceof Model) {
            return undefined;
        } else {
            return this.parent.prevFile;
        }
    }

    get nextSibling(): FolderItem | undefined {
        return this._sibling(1);
    }

    get prevSibling(): FolderItem | undefined {
        return this._sibling(-1);
    }

    private _sibling(delta: number): FolderItem | undefined {
        return _getSibling(this, this.parent.folders, delta);
    }

    move(fwd: boolean): ReferenceItem | undefined {
        if (fwd) {
            return this.nextFile === undefined ? undefined : this.nextFile.firstRef;
        } else {
            return this.prevFile === undefined ? undefined : this.prevFile.lastRef;
        }
    }

    delete() {
        _del(this.parent.folders, this);
    }

    isEmpty(): boolean {
        return this.folders.length === 0 && this.files.length === 0;
    }
}

export class FileItem  {
    private _document: Thenable<vscode.TextDocument> | undefined;

    constructor(
        readonly uri: vscode.Uri,
        readonly results: Array<ReferenceItem>,
        readonly parent: Model | FolderItem
    ) { }

    getDocument(warmUpNext?: boolean): Thenable<vscode.TextDocument> {
        if (!this._document) {
            this._document = vscode.workspace.openTextDocument(this.uri);
        }

        if (warmUpNext) {
            // load next document once this document has been loaded
            // and when next document has not yet been loaded
            const item = this.move(true);;
            if (item) {
                this._document.then(() => item.parent.getDocument(false))
            }
        }
        return this._document;
    }

    get name(): string {
        const parts = this.uri.path.split('/');
        return _last(parts);
    }

    get firstRef(): ReferenceItem {
        return this.results[0];
    }

    get lastRef(): ReferenceItem {
        return _last(this.results);
    }

    get nextSibling(): FileItem | undefined {
        return this._sibling(1);
    }

    get prevSibling(): FileItem | undefined {
        return this._sibling(-1);
    }

    private _sibling(delta: number): FileItem | undefined {
        return _getSibling(this, this.parent.files, delta);
    }

    get next(): FileItem | undefined { 
        const result = this.nextSibling;
        if (result !== undefined) {
            return result;
        }
        const container = this.parent;
        if (container instanceof Model) {
            return undefined;
        } else {
            return container.nextFile;
        }
    }

    get prev(): FileItem | undefined { 
        const result = this.prevSibling;
        if (result !== undefined) {
            return result;
        }
        const container = this.parent;
        if (container.folders.length > 0) {
            return _last(container.folders).lastFile;
        } 

        if (container instanceof Model) {
            return undefined;
        } else {
            return container.prevFile;
        }
    }

    move(fwd: boolean): ReferenceItem | undefined {
        if (fwd) {
            const next = this.next;
            return next === undefined ? undefined : next.firstRef;
        } else {
            const prev = this.prev;
            return prev === undefined ? undefined : prev.lastRef;
        }
    }

    delete() {
        _del(this.parent.files, this);
    }

    isEmpty(): boolean {
        return this.results.length === 0;
    }
}

export class ReferenceItem {
    constructor(
        readonly location: vscode.Location,
        readonly parent: FileItem,
    ) { }

    get nextSibling(): ReferenceItem | undefined {
        return this._sibling(1);
    }

    get prevSibling(): ReferenceItem | undefined {
        return this._sibling(-1)
    }

    get next(): ReferenceItem | undefined { 
        const result = this.nextSibling;
        if (result !== undefined) {
            return result;
        }
        const nextFile = this.parent.next;
        if (nextFile === undefined) {
            return undefined;
        }
        return nextFile.firstRef;
    }

    get prev(): ReferenceItem | undefined { 
        const result = this.prevSibling;
        if (result !== undefined) {
            return result;
        }
        const prevFile = this.parent.prev;
        if (prevFile === undefined) {
            return undefined;
        }
        return prevFile.lastRef;
    }

    private _sibling(delta: number): ReferenceItem | undefined {
        return _getSibling(this, this.parent.results, delta);
    }

    move(fwd: boolean): ReferenceItem | undefined {
        return fwd ? this.next : this.prev;
    }

    delete() {
        _del(this.parent.results, this);
    }
}

export class Model {
    static async create(uri: vscode.Uri, position: vscode.Position): Promise<Model | undefined> {
        let locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position);
        if (!locations) {
            return undefined;
        }
        return new Model(uri, position, locations);
    }

    private readonly _onDidChange = new vscode.EventEmitter<Model | FileItem | FolderItem >();
    readonly onDidChange = this._onDidChange.event;

    readonly folders: FolderItem[];
    readonly files: FileItem[];
    readonly showFolders: boolean;

    constructor(
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        locations: vscode.Location[],
        showFolders?: boolean
    ) {
        this.files = [];
        this.folders = [];
        if (showFolders === undefined) {
            showFolders= vscode.workspace.getConfiguration().get<boolean>('references.treeView');
        }
        this.showFolders = showFolders === undefined ? false : showFolders;
        let last: FileItem | undefined;
        locations.sort(Model._compareLocations);
        for (const loc of locations) {
            if (!last || last.uri.toString() !== loc.uri.toString()) {
                if (showFolders) {
                    const pathParts = this._getContainerComponents(loc.uri);
                    if (pathParts === undefined) {
                        continue;
                    }
                    const fileTarget = this._getOrCreate(pathParts, this, this.folders);
                    last = new FileItem(loc.uri, [], fileTarget);
                    if (fileTarget instanceof FolderItem) {
                        fileTarget.files.push(last);
                    } else {
                        this.files.push(last);
                    }
                } else {
                    last = new FileItem(loc.uri, [], this);
                    this.files.push(last);
                }
            }
            last.results.push(new ReferenceItem(loc, last));
        }
    }

    private _getContainerComponents(uri: vscode.Uri): string[] | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders === undefined) {
            return undefined;
        }
    
        for (let folder of workspaceFolders) {
            if (uri.path.startsWith(folder.uri.path)) {
                const truncatedPath = uri.path.substring(folder.uri.path.length);
                const parts = truncatedPath.split('/');
                let result = parts.slice(1, parts.length - 2);
            
                if (workspaceFolders.length === 1) {
                    return result;
                } else {
                    return [folder.name, ...result];
                }
            }
        }
    
        return undefined;
    }

    private _getOrCreate(path: string[], parent: Model | FolderItem, target: Array<FolderItem>): FolderItem | Model {
        if (path.length === 0) {
            return parent;
        }
        const first = path[0];
        for (let child of target) {
            if (child instanceof FolderItem && child.name === first) {
                return this._getOrCreate(path.slice(1), child, child.folders) as FolderItem;
            }
        }
    
        const result = new FolderItem(first, parent, [], []);
        target.push(result);
        return this._getOrCreate(path.slice(1), result, result.folders);
    }

    get isEmpty(): boolean {
        return this.files.length === 0 && this.folders.length === 0;
    }

    get totalRefs(): number {
        return this._count((f) => {
            return f.results.length;
        });
    }

    get totalFiles(): number {
        return this._count((f) => 1);
    }

    private _count(leafCounter: (f: FileItem) => number): number {
        let result = 0;
        for (const file of this._allFilesIn(this)) {
            result += leafCounter(file);
        }
        return result;
    }

    *allFiles(): IterableIterator<FileItem> {
        yield* this._allFilesIn(this);
    }

    private *_allFilesIn(item: Model | FileItem | FolderItem): IterableIterator<FileItem> {
        if (item instanceof FileItem) {
            yield item;
        } else  {
            for (let folder of item.folders) {
                yield* this._allFilesIn(folder);
            }
            yield* item.files;
        }
    }

    get(uri: vscode.Uri): FileItem | undefined {
        for (const file of this.allFiles()) {
            if (file.uri.toString() === uri.toString()) {
                return file;
            }
        }
        return undefined;
    }

    first(): ReferenceItem | undefined {
        for (const item of this.allFiles()) {
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

    remove(item: FileItem | FolderItem | ReferenceItem): void {
        let current = item;

        while (true) {
            const currentParent = current.parent;
            if (current instanceof ReferenceItem || current.isEmpty() || current === item) {
                current.delete();
            } else {
                return;
            }
            this._onDidChange.fire(currentParent);
            if (currentParent instanceof Model) {
                return;
            }
            current = currentParent;
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
}

function _getSibling<T>(item: T, siblings: T[], delta: number): T | undefined {
    const index = siblings.indexOf(item);
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= siblings.length) {
        return undefined;
    }
    return siblings[nextIndex];
}

function _last<T>(ts: T[]): T {
    return ts[ts.length - 1];
}

function _del<T>(ts: T[], t: T): void {
    const index = ts.indexOf(t);
    if (index === -1) {
        throw new Error('Can\'t find the item to delete in the array');
    }
    ts.splice(index, 1);
}
