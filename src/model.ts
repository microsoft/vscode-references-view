/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type ItemKind = 'file' | 'folder' | 'reference';

export interface FsItem {
    readonly parent: FolderItem | undefined;
    readonly name: string;

    move(fwd: boolean): ReferenceItemImpl | undefined;
}

export interface FileItem extends FsItem {
    readonly kind: 'file';
    readonly references: ReadonlyArray<ReferenceItem>;
    readonly uri: vscode.Uri;

    getDocument(warmUpNext?: boolean): Thenable<vscode.TextDocument>;
}

export interface FolderItem extends FsItem {
    readonly kind: 'folder';
    readonly files: ReadonlyArray<FileItem>;
    readonly folders: ReadonlyArray<FolderItem>;
    readonly isEmpty: boolean
}

export interface ReferenceItem {
    readonly kind: 'reference';
    readonly parent: FileItem | undefined;
    readonly location: vscode.Location;

    move(fwd: boolean): ReferenceItem | undefined;
}

export interface ModelConfiguration {
    readonly rootUris: vscode.Uri[];
    readonly showFolders: boolean;
}

export interface Model {
    readonly kind: 'model';

    readonly uri: vscode.Uri;
    readonly position: vscode.Position;

    readonly root: FolderItem;
    readonly onDidChange: vscode.Event<FileItem | FolderItem>;

    readonly isEmpty: boolean;
    readonly totalRefs: number;
    readonly totalFiles: number;

    readonly first: ReferenceItem | undefined;

    get(uri: vscode.Uri): FileItem | undefined;
    allFiles(): IterableIterator<FileItem>;
    remove(item: FolderItem | FileItem |  ReferenceItem): void;
}
 
export function getDefaultConfiguration(): ModelConfiguration {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const showFolders = vscode.workspace.getConfiguration().get<boolean>('references.treeView');
    return {
        rootUris: workspaceFolders === undefined ? [] : workspaceFolders.map((it) => it.uri),
        showFolders: showFolders || false,
    };
}

export function createModel(uri: vscode.Uri, position: vscode.Position, locations: vscode.Location[], configuration: ModelConfiguration) {
    return new ModelImpl(uri, position, locations, configuration);
}

export async function createModelsFromLocation(uri: vscode.Uri, position: vscode.Position): Promise<Model | undefined> {
    let locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position);
    if (!locations) {
        return undefined;
    }
    return new ModelImpl(uri, position, locations, getDefaultConfiguration());
}

class FolderItemImpl implements FolderItem {
    _name: string;
    _parent: FolderItemImpl | undefined;
    _files: Array<FileItemImpl> = [];
    _folders: Array<FolderItemImpl> = [];

    constructor(name: string) {
        this._name = name;
    }

    get kind(): 'folder' {
        return 'folder';
    }

    get name(): string {
        return this._name;
    }

    get parent(): FolderItem | undefined {
        return this._parent;
    }

    get files(): ReadonlyArray<FileItem> {
        return this._files;
    }

    get folders(): ReadonlyArray<FolderItem> {
        return this._folders;
    }

    get firstFile(): FileItemImpl | undefined {
        if (this.folders.length > 0) {
            return this._folders[0].firstFile;
        }
        if (this.files.length > 0) {
            return this._files[0];
        }
        return undefined;
    }

    get lastFile(): FileItemImpl | undefined {
        if (this.files.length > 0) {
            return _last(this._files);
        }
        if (this.folders.length > 0) {
            return _last(this._folders).lastFile;
        }
        return undefined;
    }

    get firstFolder(): FolderItemImpl {
        if (this.folders.length > 0) {
            return this._folders[0];
        }
        return this;
    }

    get lastFolder(): FolderItemImpl {
        if (this.folders.length > 0) {
            return _last(this._folders);
        }
        return this;
    }

    get nextFile(): FileItemImpl | undefined {
        const result = this.nextSibling;
        if (result !== undefined) {
            return result.firstFolder.firstFile;
        }
        const parent = this._parent;
        if (parent === undefined) {
            return undefined;
        }
        if (parent._files.length > 0) {
            return parent._files[0];
        }
        return parent.nextFile;
    }

    get prevFile(): FileItemImpl | undefined {
        const result = this.prevSibling;
        if (result !== undefined) {
            return result.lastFolder.lastFile;
        }
        const parent = this._parent;
        if (parent === undefined) {
            return undefined;
        }
        return parent.prevFile;
    }

    get nextSibling(): FolderItemImpl | undefined {
        return this._sibling(1);
    }

    get prevSibling(): FolderItemImpl | undefined {
        return this._sibling(-1);
    }

    private _sibling(delta: number): FolderItemImpl | undefined {
        const parent = this._parent;
        if (parent === undefined) {
            return undefined;
        }
        return _getSibling(this, parent._folders, delta);
    }

    move(fwd: boolean): ReferenceItemImpl | undefined {
        if (fwd) {
            return this.nextFile === undefined ? undefined : this.nextFile.firstRef;
        } else {
            return this.prevFile === undefined ? undefined : this.prevFile.lastRef;
        }
    }

    addFolder(folder: FolderItemImpl) {
        if (folder._parent !== undefined) {
            throw new Error('Folder is already attached');
        }
        this._folders.push(folder);
        folder._parent = this;
    }

    addFile(file: FileItemImpl) {
        if (file._parent !== undefined) {
            throw new Error('File is already attached');
        }
        this._files.push(file);
        file._parent = this;
    }

    delete() {
        const parent = this._parent;
        if (parent === undefined) {
            throw new Error('Can\'t delete detached folder');
        }
        _del(parent._folders, this);
        this._parent = undefined;
    }

    get isEmpty(): boolean {
        return this.folders.length === 0 && this.files.length === 0;
    }
}

class FileItemImpl implements FileItem {
    _document: Thenable<vscode.TextDocument> | undefined;
    _references: Array<ReferenceItemImpl> = [];
    _parent: FolderItemImpl | undefined = undefined;
    
    constructor(
        readonly uri: vscode.Uri
    ) {
    }

    get kind(): 'file' {
        return 'file';
    }

    get parent(): FolderItem | undefined {
        return this._parent;
    }

    get name(): string {
        return 'abc';
    }

    get references(): ReadonlyArray<ReferenceItem> {
        return this._references;
    }

    getDocument(warmUpNext?: boolean): Thenable<vscode.TextDocument> {
        if (!this._document) {
            this._document = vscode.workspace.openTextDocument(this.uri);
        }

        if (warmUpNext) {
            // load next document once this document has been loaded
            // and when next document has not yet been loaded
            const item = this.move(true);;
            if (item) {
                this._document.then(() => {
                    const parent = item._parent;
                    if (parent !== undefined) {
                        parent.getDocument(false);
                    }
                });
            }
        }
        return this._document;
    }

    get firstRef(): ReferenceItemImpl {
        return this._references[0];
    }

    get lastRef(): ReferenceItemImpl {
        return _last(this._references);
    }

    get nextSibling(): FileItemImpl | undefined {
        return this._sibling(1);
    }

    get prevSibling(): FileItemImpl | undefined {
        return this._sibling(-1);
    }

    private _sibling(delta: number): FileItemImpl | undefined {
        const parent = this._parent;
        if (parent === undefined) {
            return undefined;
        }
        return _getSibling(this, parent._files, delta);
    }

    get next(): FileItemImpl | undefined { 
        const result = this.nextSibling;
        if (result !== undefined) {
            return result;
        }
        const parent = this._parent;
        if (parent === undefined) {
            return undefined;
        }
        return parent.nextFile;
    }

    get prev(): FileItemImpl | undefined { 
        const result = this.prevSibling;
        if (result !== undefined) {
            return result;
        }
        const parent = this._parent;
        if (parent === undefined) {
            return undefined;
        }
        if (parent._folders.length > 0) {
            return _last(parent._folders).lastFile;
        } 
        return parent.prevFile;
    }

    addRef(ref: ReferenceItemImpl) {
        if (ref._parent !== undefined) {
            throw new Error('Reference is already attached');
        }
        this._references.push(ref);
        ref._parent = this;
    }

    move(fwd: boolean): ReferenceItemImpl | undefined {
        if (fwd) {
            const next = this.next;
            return next === undefined ? undefined : next.firstRef;
        } else {
            const prev = this.prev;
            return prev === undefined ? undefined : prev.lastRef;
        }
    }

    delete() {
        const parent = this._parent;
        if (parent === undefined) {
            throw new Error('Can\'t delete detached file');
        }
        _del(parent._files, this);
        this._parent = undefined;
    }

    isEmpty(): boolean {
        return this._references.length === 0;
    }
}

class ReferenceItemImpl implements ReferenceItem {
    _parent: FileItemImpl | undefined;

    constructor(
        readonly location: vscode.Location
    )  {
    }

    get kind(): 'reference' {
        return 'reference';
    }

    get parent(): FileItemImpl | undefined {
        return this._parent;
    }

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
        const parent = this._parent;
        if (parent == undefined) {
            return undefined
        }
        const nextFile = parent.next;
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
        const parent = this._parent;
        if (parent === undefined) {
            return undefined;
        }
        const prevFile = parent.prev;
        if (prevFile === undefined) {
            return undefined;
        }
        return prevFile.lastRef;
    }

    private _sibling(delta: number): ReferenceItem | undefined {
        const parent = this.parent;
        if (parent === undefined) {
            return undefined;
        }
        return _getSibling(this, parent.references, delta);
    }

    move(fwd: boolean): ReferenceItem | undefined {
        return fwd ? this.next : this.prev;
    }

    delete() {
        const parent = this._parent;
        if (parent === undefined) {
            throw new Error('Can\'t delete detached reference');
        }
        _del(parent._references, this);
        this._parent = undefined;
    }
}

class ModelImpl implements Model {
    readonly _onDidChange = new vscode.EventEmitter<FileItem | FolderItem>();
    readonly onDidChange = this._onDidChange.event;
    readonly root: FolderItemImpl = new FolderItemImpl('');

    constructor(
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        locations: vscode.Location[],
        readonly configuration: ModelConfiguration
    ) {
        let last: FileItemImpl | undefined;
        locations.sort(ModelImpl._compareLocations);
        for (const loc of locations) {
            if (!last || last.uri.toString() !== loc.uri.toString()) {
                if (this.configuration.showFolders) {
                    const pathParts = this._getContainerComponents(loc.uri);
                    if (pathParts === undefined) {
                        continue;
                    }
                    const fileTarget = this._getOrCreate(pathParts, this.root);
                    last = new FileItemImpl(loc.uri);
                    fileTarget.addFile(last);
                } else {
                    last = new FileItemImpl(loc.uri);
                    this.root.addFile(last);
                }
            }
            last.addRef(new ReferenceItemImpl(loc));
        }
        this.compactTree(this.root);
    }

    get kind(): 'model' {
        return 'model';
    }

    get isEmpty(): boolean {
        return this.root.files.length === 0 && this.root.folders.length === 0;
    }

    get totalRefs(): number {
        return this._count((f) => {
            return f.references.length;
        });
    }

    get totalFiles(): number {
        return this._count((f) => 1);
    }

    private _count(leafCounter: (f: FileItem) => number): number {
        let result = 0;
        for (const file of this._allFilesIn(this.root)) {
            result += leafCounter(file);
        }
        return result;
    }

    *allFiles(): IterableIterator<FileItemImpl> {
        yield* this._allFilesIn(this.root);
    }

    private *_allFilesIn(item: FileItemImpl | FolderItemImpl): IterableIterator<FileItemImpl> {
        if (item instanceof FileItemImpl) {
            yield item;
        } else {
            for (let folder of item._folders) {
                yield* this._allFilesIn(folder);
            }
            yield* item._files;
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

    get first(): ReferenceItem | undefined {
        for (const item of this.allFiles()) {
            if (item.uri.toString() === this.uri.toString()) {
                for (const ref of item.references) {
                    if (ref.location.range.contains(this.position)) {
                        return ref;
                    }
                }
                return undefined;
            }
        }
        return undefined;
    }

    private cleanupFile(file: FileItemImpl | undefined) {
        if (file === undefined) {
            return;
        }
        this._onDidChange.fire(file);

        if (file.isEmpty) {
            this.deleteFileOrFolder(file);
        }
    }

    private cleanupFolder(folder: FolderItemImpl | undefined) {
        if (folder === undefined) {
            return;
        }
        this._onDidChange.fire(folder);
        if (folder.isEmpty && folder !== this.root) {
            this.deleteFileOrFolder(folder);
        } else {
            if (this.compactTree(this.root)) {
                this._onDidChange.fire(folder);
            }
        }
    }

    private deleteFileOrFolder(item: FileItemImpl | FolderItemImpl) {
        const parent = item._parent;
        item.delete();
        this.cleanupFolder(parent);
    }

    remove(item: FileItem | FolderItem | ReferenceItem): void {
        if (item instanceof ReferenceItemImpl) {
            const parent = item._parent;
            item.delete();
            this.cleanupFile(parent);
        } else if (item instanceof FileItemImpl || item instanceof FolderItemImpl) {
            this.deleteFileOrFolder(item);
        } else {
            throw new Error('Unknown item : ' + item);
        }
    }

    private _getOrCreate(path: string[], parent: FolderItemImpl): FolderItemImpl {
        if (path.length === 0) {
            return parent;
        }
        const first = path[0];
        for (let child of parent._folders) {
            if (child instanceof FolderItemImpl && child.name === first) {
                return this._getOrCreate(path.slice(1), child) as FolderItemImpl;
            }
        }

        const result = new FolderItemImpl(first);
        parent.addFolder(result);
        return this._getOrCreate(path.slice(1), result);
    }

    private _getContainerComponents(uri: vscode.Uri): string[] | undefined {
        const rootUris = this.configuration.rootUris;
        for (let folderUri of rootUris) {
            const pathParts = folderUri.path.split('/');
            const name = pathParts[pathParts.length - 1];
            if (uri.path.startsWith(folderUri.path)) {
                const truncatedPath = uri.path.substring(folderUri.path.length);
                const parts = truncatedPath.split('/');
                let result = parts.slice(1, parts.length - 2);
                if (rootUris.length === 1) {
                    return result;
                } else {
                    return [name, ...result];
                }
            }
        }
        return undefined;
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

    private compactTree(folder: FolderItemImpl): boolean {
        let current: FolderItemImpl = folder;
        let compacted = false;
        while (true) {
            const compactedTree = this.compactFolder(current)
            if (compactedTree === undefined) {
                break;
            }
            compacted = true;
            current = compactedTree;
        }

        for (let child of current._folders) {
            compacted = compacted || this.compactTree(child);
        }

        return compacted;
    }

    private compactFolder(folder: FolderItemImpl): FolderItemImpl | undefined {
        if (folder === this.root) {
            return undefined;
        }

        if (folder._files.length === 0 && folder._folders.length == 1) {
            const replaceWith = folder._folders[0];
            replaceWith._name = folder._name + '/' + replaceWith._name;
            replaceWith._parent = folder._parent;

            const parent = folder._parent;
            if (parent === undefined) {
                throw new Error('It can\'t happen');
            }

            const index = parent._folders.indexOf(folder);
            parent._folders[index] = replaceWith;

            return replaceWith;
        }

        return undefined;
    }
}

function _getSibling<T>(item: T, siblings: ReadonlyArray<T>, delta: number): T | undefined {
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
