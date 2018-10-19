'use strict';

import * as vscode from 'vscode';

class ReferenceSearchModel {

    private _resolve: Promise<this> | undefined;

    constructor(
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        readonly items = new Set<FileItem>()
    ) {
        //
    }

    get resolve(): Promise<this> {
        if (!this._resolve) {
            this._resolve = this._doResolve();
        }
        return this._resolve;
    }

    reset() {
        this._resolve = undefined;
    }

    private async _doResolve(): Promise<this> {
        this.items.clear();
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            this.uri,
            this.position
        );
        if (locations) {
            let last: FileItem | undefined;
            locations.sort(ReferenceSearchModel._compareLocations);
            for (const loc of locations) {
                if (!last || last.uri.toString() !== loc.uri.toString()) {
                    last = new FileItem(loc.uri, new Set(), loc.uri.toString() === this.uri.toString());
                    this.items.add(last);
                }
                last.results.add(new ReferenceItem(loc, last));
            }
        }
        return this;
    }

    remove(item: FileItem | ReferenceItem): FileItem | undefined {
        if (item instanceof FileItem) {
            this.items.delete(item);
            return undefined;
        } else if (item instanceof ReferenceItem) {
            item.parent.results.delete(item);
            if (item.parent.results.size === 0) {
                this.items.delete(item.parent);
                return undefined;
            } else {
                return item.parent;
            }
        }
    }

    private static _compareLocations(a: vscode.Location, b: vscode.Location): number {
        if (a.uri.toString() < b.uri.toString()) {
            return -1;
        } else if (a.uri.toString() > b.uri.toString()) {
            return 1;
        } else if (a.range.start.isBeforeOrEqual(b.range.start)) {
            return -1;
        } else if (a.range.start.isAfter(b.range.start)) {
            return 1;
        } else {
            return 0;
        }
    }
}

class FileItem {
    constructor(
        readonly uri: vscode.Uri,
        readonly results: Set<ReferenceItem>,
        readonly isFileOfRequest: boolean
    ) { }
}

class ReferenceItem {
    constructor(
        readonly location: vscode.Location,
        readonly parent: FileItem,
    ) { }
}

type TreeObject = FileItem | ReferenceItem;

class DataProvider implements vscode.TreeDataProvider<TreeObject> {

    readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeObject>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _model?: ReferenceSearchModel;

    setModel(model?: ReferenceSearchModel) {
        this._model = model;
        this._onDidChangeTreeData.fire();
        vscode.commands.executeCommand('setContext', 'reference-list.hasResult', Boolean(this._model))
    }

    getModel(): ReferenceSearchModel | undefined {
        return this._model;
    }

    async getTreeItem(element: TreeObject): Promise<vscode.TreeItem> {

        if (element instanceof FileItem) {
            let result: vscode.TreeItem;
            result = new vscode.TreeItem(element.uri);
            result.contextValue = 'reference-item'
            result.iconPath = vscode.ThemeIcon.File;
            result.collapsibleState = element.isFileOfRequest
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
            return result;
        }

        if (element instanceof ReferenceItem) {
            const { range } = element.location;
            const doc = await vscode.workspace.openTextDocument(element.location.uri);

            let previewEnd = range.end.translate(0, 31);
            let previewStart = range.start.with({ character: Math.max(0, range.start.character - 8) });
            let wordRange = doc.getWordRangeAtPosition(previewStart);
            if (wordRange) {
                previewStart = wordRange.start;
            }

            let label = `${doc.getText(new vscode.Range(previewStart, range.start))}'${doc.getText(range)}'${doc.getText(new vscode.Range(range.end, previewEnd))}`;
            let result: vscode.TreeItem;
            result = new vscode.TreeItem(label.trim());
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.contextValue = 'reference-item'
            result.command = {
                title: 'Open Reference',
                command: 'references-view.show',
                arguments: [element]
            }
            return result;
        }

        throw new Error();
    }

    async getChildren(element?: TreeObject | undefined): Promise<TreeObject[]> {
        if (element instanceof FileItem) {
            return [...element.results];
        } else if (this._model) {
            return [...(await this._model.resolve).items];
        } else {
            return [];
        }
    }

    getParent(element: TreeObject): TreeObject | undefined {
        return element instanceof ReferenceItem
            ? element.parent
            : undefined;
    }
}

export function activate(context: vscode.ExtensionContext) {

    const treeDataProvider = new DataProvider();
    const view = vscode.window.createTreeView('references-view.tree', { treeDataProvider });

    const findCommand = async (editor: vscode.TextEditor) => {
        if (editor.document.getWordRangeAtPosition(editor.selection.active)) {
            const model = new ReferenceSearchModel(editor.document.uri, editor.selection.active);
            treeDataProvider.setModel(model);
            await model.resolve
            for (const item of model.items) {
                if (item.isFileOfRequest) {
                    view.reveal(item, { select: true, focus: true });
                }
            }
        }
    };

    const refreshCommand = () => {
        const model = treeDataProvider.getModel();
        if (model) {
            model.reset();
            treeDataProvider._onDidChangeTreeData.fire();
        }
    }

    const clearCommand = () => {
        treeDataProvider.setModel(undefined);
    }

    const showRefCommand = (arg?: ReferenceItem | any) => {
        if (arg instanceof ReferenceItem) {
            const { location } = arg;
            vscode.window.showTextDocument(location.uri, { selection: location.range });
        }
    };

    const removeRefCommand = (arg?: ReferenceItem | any) => {
        const model = treeDataProvider.getModel();
        if (model) {
            const parent = model.remove(arg);
            treeDataProvider._onDidChangeTreeData.fire(parent);
        }
    };

    context.subscriptions.push(
        view,
        vscode.commands.registerTextEditorCommand('references-view.find', findCommand),
        vscode.commands.registerTextEditorCommand('references-view.refresh', refreshCommand),
        vscode.commands.registerTextEditorCommand('references-view.clear', clearCommand),
        vscode.commands.registerCommand('references-view.show', showRefCommand),
        vscode.commands.registerCommand('references-view.remove', removeRefCommand),
    );
}
