/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { del, getPreviewChunks } from '../models';
import { SymbolTreeInput } from '../tree';

export class LocationTreeInput implements SymbolTreeInput {

	constructor(
		readonly title: string,
		readonly uri: vscode.Uri,
		readonly position: vscode.Position,
		private readonly _command: vscode.Command,
	) { }

	resolve() {
		const result = Promise.resolve(vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(this._command.command, ...(this._command.arguments ?? [])));
		const model = new LocationsModel(result);

		return {
			provider: model,
			get message() { return model.message; }
		};
	}
}

class LocationsModel implements Required<vscode.TreeDataProvider<FileItem | ReferenceItem>>{

	private _onDidChange = new vscode.EventEmitter<FileItem | ReferenceItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	_items?: FileItem[];
	_ready: Promise<any>;

	constructor(locations: Promise<vscode.Location[] | vscode.LocationLink[] | undefined>) {

		this._ready = locations.then(locations => {
			const items: FileItem[] = [];
			if (locations) {
				let last: FileItem | undefined;
				for (const item of locations.sort(LocationsModel._compareLocations)) {
					const loc = item instanceof vscode.Location
						? item
						: new vscode.Location(item.targetUri, item.targetRange);

					if (!last || LocationsModel._compareUriIgnoreFragment(last.uri, loc.uri) !== 0) {
						last = new FileItem(loc.uri.with({ fragment: '' }), [], this);
						items.push(last);
					}
					last.references.push(new ReferenceItem(loc, last));
				}
			}
			this._items = items;
		});
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

	private _assertResolved(): asserts this is Required<LocationsModel> {
		if (!this._items) {
			throw Error('items NOT resolved yet');
		}
	}

	// --- adapter

	get message() {
		if (!this._items) {
			return undefined;
		}
		const total = this._items.reduce((prev, cur) => prev + cur.references.length, 0);
		const files = this._items.length;
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

	next(item: FileItem): FileItem {
		this._assertResolved();
		const idx = this._items.indexOf(item);
		const next = idx + 1 % this._items.length;
		return this._items[next];
	}

	previous(item: FileItem): FileItem {
		this._assertResolved();
		const idx = this._items.indexOf(item);
		const prev = idx - 1 + this._items.length % this._items.length;
		return this._items[prev];
	}

	remove(item: FileItem | ReferenceItem) {
		this._assertResolved();
		if (item instanceof FileItem) {
			del(this._items, item);
			this._onDidChange.fire(undefined);
		} else {
			del(item.file.references, item);
			if (item.file.references.length === 0) {
				del(this._items, item.file);
				this._onDidChange.fire(undefined);
			} else {
				this._onDidChange.fire(item.file);
			}
		}
	}

	async asCopyText() {
		this._assertResolved();
		let result = '';
		for (const item of this._items) {
			result += `${await item.asCopyText()}\n`;
		}
		return result;
	}

	// --- data provider mechanics

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
			result.command = { command: 'references-view.show', title: 'Open Reference', arguments: [element] };
			return result;
		}
	}

	async getChildren(element?: FileItem | ReferenceItem) {

		await this._ready;

		if (!element) {
			return this._items;
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

class ReferenceItem {

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
			const next = this.file.model.next(this.file);
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
