/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { del, getPreviewChunks, prefixLen, tail } from '../models';
import { SymbolItemHighlights as SymbolItemEditorHighlights, SymbolItemNavigation, SymbolTreeInput, SymbolTreeModel } from '../tree';

export class LocationTreeInput implements SymbolTreeInput {

	constructor(
		readonly title: string,
		readonly uri: vscode.Uri,
		readonly position: vscode.Position,
		private readonly _command: string,
	) { }

	async resolve() {

		const result = Promise.resolve(vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(this._command, this.uri, this.position));
		const model = new LocationsModel(await result ?? []);

		return <SymbolTreeModel>{
			provider: new LocationsTreeDataProvider(model),
			get message() { return model.message; },
			navigation: model,
			highlights: model
		};
	}

	hash(): string {
		return JSON.stringify([this.uri, this.position, this._command]);
	}
}

class LocationsModel implements SymbolItemNavigation<FileItem | ReferenceItem>, SymbolItemEditorHighlights<FileItem | ReferenceItem> {

	private _onDidChange = new vscode.EventEmitter<FileItem | ReferenceItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	readonly items: FileItem[] = [];

	constructor(locations: vscode.Location[] | vscode.LocationLink[]) {
		let last: FileItem | undefined;
		for (const item of locations.sort(LocationsModel._compareLocations)) {
			const loc = item instanceof vscode.Location
				? item
				: new vscode.Location(item.targetUri, item.targetRange);

			if (!last || LocationsModel._compareUriIgnoreFragment(last.uri, loc.uri) !== 0) {
				last = new FileItem(loc.uri.with({ fragment: '' }), [], this);
				this.items.push(last);
			}
			last.references.push(new ReferenceItem(loc, last));
		}
	}

	private static _compareUriIgnoreFragment(a: vscode.Uri, b: vscode.Uri): number {
		let aStr = a.with({ fragment: '' }).toString();
		let bStr = b.with({ fragment: '' }).toString();
		if (aStr < bStr) {
			return -1;
		} else if (aStr > bStr) {
			return 1;
		}
		return 0;
	}

	private static _compareLocations(a: vscode.Location | vscode.LocationLink, b: vscode.Location | vscode.LocationLink): number {
		let aUri = a instanceof vscode.Location ? a.uri : a.targetUri;
		let bUri = b instanceof vscode.Location ? b.uri : b.targetUri;
		if (aUri.toString() < bUri.toString()) {
			return -1;
		} else if (aUri.toString() > bUri.toString()) {
			return 1;
		}

		let aRange = a instanceof vscode.Location ? a.range : a.targetRange;
		let bRange = b instanceof vscode.Location ? b.range : b.targetRange;
		if (aRange.start.isBefore(bRange.start)) {
			return -1;
		} else if (aRange.start.isAfter(bRange.start)) {
			return 1;
		} else {
			return 0;
		}
	}

	// --- adapter

	get message() {
		if (!this.items) {
			return undefined;
		}
		const total = this.items.reduce((prev, cur) => prev + cur.references.length, 0);
		const files = this.items.length;
		if (total === 1 && files === 1) {
			return `${total} result in ${files} file`;
		} else if (total === 1) {
			return `${total} result in ${files} files`;
		} else if (files === 1) {
			return `${total} results in ${files} file`;
		} else {
			return `${total} results in ${files} files`;
		}
	}

	nearest(uri: vscode.Uri, position: vscode.Position): FileItem | ReferenceItem | undefined {

		if (this.items.length === 0) {
			return;
		}
		// NOTE: this.items is sorted by location (uri/range)
		for (const item of this.items) {
			if (item.uri.toString() === uri.toString()) {
				// (1) pick the item at the request position
				for (const ref of item.references) {
					if (ref.location.range.contains(position)) {
						return ref;
					}
				}
				// (2) pick the first item after or last before the request position
				let lastBefore: ReferenceItem | undefined;
				for (const ref of item.references) {
					if (ref.location.range.end.isAfter(position)) {
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
		let bestValue = prefixLen(this.items[best].toString(), uri.toString());

		for (let i = 1; i < this.items.length; i++) {
			let value = prefixLen(this.items[i].uri.toString(), uri.toString());
			if (value > bestValue) {
				best = i;
			}
		}

		return this.items[best].references[0];
	}

	next(item: FileItem | ReferenceItem): FileItem | ReferenceItem {
		return this._move(item, true) ?? item;
	}

	previous(item: FileItem | ReferenceItem): FileItem | ReferenceItem {
		return this._move(item, false) ?? item;
	}

	private _move(item: FileItem | ReferenceItem, fwd: boolean): ReferenceItem | undefined {

		const delta = fwd ? +1 : -1;

		const _move = (item: FileItem): FileItem => {
			const idx = (this.items.indexOf(item) + delta + this.items.length) % this.items.length;
			return this.items[idx];
		};

		if (item instanceof FileItem) {
			if (fwd) {
				return _move(item).references[0];
			} else {
				return tail(_move(item).references);
			}
		}

		if (item instanceof ReferenceItem) {
			const idx = item.file.references.indexOf(item) + delta;
			if (idx < 0) {
				return tail(_move(item.file).references);
			} else if (idx >= item.file.references.length) {
				return _move(item.file).references[0];
			} else {
				return item.file.references[idx];
			}
		}
	}

	getEditorHighlights(_item: FileItem | ReferenceItem, uri: vscode.Uri): vscode.Range[] | undefined {
		const file = this.items.find(file => file.uri.toString() === uri.toString());
		return file?.references.map(ref => ref.location.range);
	}

	remove(item: FileItem | ReferenceItem) {
		if (item instanceof FileItem) {
			del(this.items, item);
			this._onDidChange.fire(undefined);
		} else {
			del(item.file.references, item);
			if (item.file.references.length === 0) {
				del(this.items, item.file);
				this._onDidChange.fire(undefined);
			} else {
				this._onDidChange.fire(item.file);
			}
		}
	}

	async asCopyText() {
		let result = '';
		for (const item of this.items) {
			result += `${await item.asCopyText()}\n`;
		}
		return result;
	}

}

class LocationsTreeDataProvider implements Required<vscode.TreeDataProvider<FileItem | ReferenceItem>>{

	private readonly _listener: vscode.Disposable;
	private readonly _onDidChange = new vscode.EventEmitter<FileItem | ReferenceItem | undefined>();

	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private readonly _model: LocationsModel) {
		this._listener = _model.onDidChangeTreeData(e => this._onDidChange.fire());
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._listener.dispose();
	}

	async getTreeItem(element: FileItem | ReferenceItem) {
		if (element instanceof FileItem) {
			// files
			const result = new vscode.TreeItem(element.uri);
			result.contextValue = 'file-item';
			result.description = true;
			result.iconPath = vscode.ThemeIcon.File;
			result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
			return result;

		} else {
			// references
			const { range } = element.location;
			const doc = await element.getDocument(true);
			const { before, inside, after } = getPreviewChunks(doc, range);

			const label: vscode.TreeItemLabel = {
				label: before + inside + after,
				highlights: [[before.length, before.length + inside.length]]
			};

			const result = new vscode.TreeItem2(label);
			result.collapsibleState = vscode.TreeItemCollapsibleState.None;
			result.contextValue = 'reference-item';
			result.command = { command: 'references-view.showReferenceItem', title: 'Open Reference', arguments: [element] };
			return result;
		}
	}

	async getChildren(element?: FileItem | ReferenceItem) {
		if (!element) {
			return this._model.items;
		}
		if (element instanceof FileItem) {
			return element.references;
		}
		return undefined;
	}

	getParent(element: FileItem | ReferenceItem) {
		return element instanceof ReferenceItem ? element.file : undefined;
	}
}

class FileItem {

	constructor(
		readonly uri: vscode.Uri,
		readonly references: Array<ReferenceItem>,
		readonly model: LocationsModel
	) { }

	// --- adapter

	remove(): void {
		this.model.remove(this);
	}

	async asCopyText() {
		let result = `${vscode.workspace.asRelativePath(this.uri)}\n`;
		for (let ref of this.references) {
			result += `  ${await ref.asCopyText()}\n`;
		}
		return result;
	}
}

export class ReferenceItem {

	private _document: Thenable<vscode.TextDocument> | undefined;

	constructor(
		readonly location: vscode.Location,
		readonly file: FileItem,
	) { }

	async getDocument(warmUpNext?: boolean) {
		if (!this._document) {
			this._document = vscode.workspace.openTextDocument(this.location.uri);
		}
		if (warmUpNext) {
			// load next document once this document has been loaded
			const next = <FileItem>this.file.model.next(this.file);
			if (next !== this.file) {
				vscode.workspace.openTextDocument(next.uri);
			}
		}
		return this._document;
	}

	// --- adapter

	remove(): void {
		this.file.model.remove(this);
	}

	async asCopyText() {
		let doc = await this.getDocument();
		let chunks = getPreviewChunks(doc, this.location.range, 21, false);
		return `${this.location.range.start.line + 1}, ${this.location.range.start.character + 1}: ${chunks.before + chunks.inside + chunks.after}`;
	}
}
