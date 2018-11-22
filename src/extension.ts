'use strict';

import * as vscode from 'vscode';


interface HistoryItem {
    id: string;
    preview: Thenable<string | undefined>;
    uri: vscode.Uri,
    position: vscode.Position;
}

class History {

    private readonly _items = new Map<string, HistoryItem>();

    *[Symbol.iterator]() {
        let values = [...this._items.values()];
        for (let i = values.length - 1; i >= 0; i--) {
            yield values[i];
        }
    }

    add({ uri, position }: ReferenceSearchModel): void {

        const id = History._makeId(uri, position);
        const preview = vscode.workspace.openTextDocument(uri).then(doc => {
            let range = doc.getWordRangeAtPosition(position);
            if (range) {
                let { before, inside, after } = getPreviewChunks(doc, range);

                // ensure whitespace isn't trimmed when rendering MD
                before = before.replace(/s$/g, String.fromCharCode(160));
                after = after.replace(/^s/g, String.fromCharCode(160));

                // make command link
                let query = encodeURIComponent(JSON.stringify([id]));
                let title = `${vscode.workspace.asRelativePath(uri)}:${position.line + 1}:${position.character + 1}`;
                inside = `[${inside}](command:references-view.refind?${query} "${title}")`;

                return before + inside + after;
            }
        });

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

class FileItem {
    constructor(
        readonly uri: vscode.Uri,
        readonly results: Array<ReferenceItem>
    ) { }
}

class ReferenceItem {
    constructor(
        readonly location: vscode.Location,
        readonly parent: FileItem,
    ) { }
}

type TreeObject = FileItem | ReferenceItem;

class ReferenceSearchModel {

    private _resolve: Promise<this> | undefined;
    private _total: number = 0;

    constructor(
        readonly uri: vscode.Uri,
        readonly position: vscode.Position,
        readonly items = new Array<FileItem>()
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
        this.items.length = 0
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            this.uri,
            this.position
        );
        if (locations) {
            this._total = locations.length;
            let last: FileItem | undefined;
            locations.sort(ReferenceSearchModel._compareLocations);
            for (const loc of locations) {
                if (!last || last.uri.toString() !== loc.uri.toString()) {
                    last = new FileItem(loc.uri, []);
                    this.items.push(last);
                }
                last.results.push(new ReferenceItem(loc, last));
            }
        }
        return this;
    }

    get total(): number {
        return this._total;
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
            ReferenceSearchModel._del(this.items, item);
            return undefined;

        } else if (item instanceof ReferenceItem) {
            ReferenceSearchModel._del(item.parent.results, item);
            if (item.parent.results.length === 0) {
                ReferenceSearchModel._del(this.items, item.parent);
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
                return ReferenceSearchModel._tail(_move(item).results);
            }
        }

        if (item instanceof ReferenceItem) {
            const idx = item.parent.results.indexOf(item) + delta;
            if (idx < 0) {
                return ReferenceSearchModel._tail(_move(item.parent).results);
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

function getPreviewChunks(doc: vscode.TextDocument, range: vscode.Range) {
    const previewStart = range.start.with({ character: Math.max(0, range.start.character - 8) });
    const wordRange = doc.getWordRangeAtPosition(previewStart);
    const before = doc.getText(new vscode.Range(wordRange ? wordRange.start : previewStart, range.start)).replace(/^\s*/g, '');
    const inside = doc.getText(range);
    const previewEnd = range.end.translate(0, 331);
    const after = doc.getText(new vscode.Range(range.end, previewEnd)).replace(/\s*$/g, '');
    return { before, inside, after }
}

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
            // files
            const result = new vscode.TreeItem(element.uri);
            result.contextValue = 'reference-item'
            result.description = true;
            result.iconPath = vscode.ThemeIcon.File;
            result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            return result;
        }

        if (element instanceof ReferenceItem) {
            // references
            const { range } = element.location;
            const doc = await vscode.workspace.openTextDocument(element.location.uri);

            const { before, inside, after } = getPreviewChunks(doc, range);

            const label: vscode.TreeItemLabel = {
                label: before + inside + after,
                highlights: [[before.length, before.length + inside.length]]
            };

            const result = new vscode.TreeItem2(label);
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
            return element.results;
        } else if (this._model) {
            return (await this._model.resolve).items;
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

    const viewId = 'references-view.tree';
    const history = new History();
    const treeDataProvider = new DataProvider();

    const view = vscode.window.createTreeView(viewId, {
        treeDataProvider,
        showCollapseAll: true
    });

    const editorHighlights = new class {

        private _decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            overviewRulerLane: vscode.OverviewRulerLane.Center
        });

        private _editorListener = vscode.window.onDidChangeActiveTextEditor(this.add, this);
        private _viewListener = view.onDidChangeVisibility(e => e.visible ? this.add() : this.clear());

        dispose() {
            this.clear();
            this._editorListener.dispose();
            this._viewListener.dispose();
        }

        add() {
            const { activeTextEditor: editor } = vscode.window;
            const model = treeDataProvider.getModel();
            if (!editor || !model) {
                return;
            }
            const item = model.get(editor.document.uri);
            if (item) {
                editor.setDecorations(this._decorationType, item.results.map(ref => ref.location.range));
            }
        }

        clear() {
            const { activeTextEditor: editor } = vscode.window;
            if (editor) {
                editor.setDecorations(this._decorationType, []);
            }
        }

        reset() {
            this.clear();
            this.add();
        }
    }

    const findCommand = async (uri?: vscode.Uri, position?: vscode.Position) => {
        // upon first interaction set the reference list as active
        // which will reveal it
        vscode.commands.executeCommand('setContext', 'reference-list.isActive', true)

        // remove existing highlights
        editorHighlights.clear();
        view.message = undefined;

        let model: ReferenceSearchModel | undefined = undefined;
        if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
            // trust args if correct'ish
            model = new ReferenceSearchModel(uri, position);

        } else if (vscode.window.activeTextEditor) {
            let editor = vscode.window.activeTextEditor;
            if (editor.document.getWordRangeAtPosition(editor.selection.active)) {
                model = new ReferenceSearchModel(editor.document.uri, editor.selection.active);
            }
        }

        if (model) {
            treeDataProvider.setModel(model);
            history.add(model);

            await model.resolve;

            // update editor
            editorHighlights.add();

            // udate tree
            const selection = model.first();
            if (selection) {
                view.reveal(selection, { select: true, focus: true });
                vscode.commands.executeCommand(`${viewId}.focus`);
            }

            // update message
            if (model.total === 1 && model.items.length === 1) {
                view.message = new vscode.MarkdownString(`${model.total} result in ${model.items.length} file`);
            } else if (model.total === 1) {
                view.message = new vscode.MarkdownString(`${model.total} result in ${model.items.length} files`);
            } else if (model.items.length === 1) {
                view.message = new vscode.MarkdownString(`${model.total} results in ${model.items.length} file`);
            } else {
                view.message = new vscode.MarkdownString(`${model.total} results in ${model.items.length} files`);
            }
        }
    };

    const refindCommand = (id: string) => {
        if (typeof id !== 'string') {
            return;
        }
        let item = history.get(id);
        if (item) {
            return findCommand(item.uri, item.position);
        }
    }

    const refreshCommand = async () => {
        const model = treeDataProvider.getModel();
        if (model) {
            model.reset();
            treeDataProvider._onDidChangeTreeData.fire();
            await model.resolve
            editorHighlights.reset();
            view.reveal(view.selection[0]);
        }
    }

    const clearCommand = async () => {
        editorHighlights.clear();
        treeDataProvider.setModel(undefined);

        let message = new vscode.MarkdownString(`To populate this view, open an editor and run the 'Find All References'-command or run a previous search again:\n`)
        message.isTrusted = true;
        for (const item of history) {
            let md = await item.preview;
            if (md) {
                message.appendMarkdown(`* ${md}\n`);
            }
        }
        view.message = message;
    }

    const showRefCommand = (arg?: ReferenceItem | any) => {
        if (arg instanceof ReferenceItem) {
            const { location } = arg;
            vscode.window.showTextDocument(location.uri, {
                selection: location.range.with({ end: location.range.start }),
                preserveFocus: true
            });
        }
    };

    const removeRefCommand = (arg?: ReferenceItem | any) => {
        const model = treeDataProvider.getModel();
        if (model) {
            const next = model.move(arg, true);
            const parent = model.remove(arg);
            treeDataProvider._onDidChangeTreeData.fire(parent);
            editorHighlights.reset();
            if (next) {
                view.reveal(next, { select: true });
            }
        }
    };

    const moveCommand = (fwd: boolean) => {
        const model = treeDataProvider.getModel();
        if (!model) {
            return;
        }
        const selection = view.selection[0] || model.first();
        const next = model.move(selection, fwd);
        if (next) {
            view.reveal(next, { select: true });
            showRefCommand(next);
        }
    }

    context.subscriptions.push(
        view,
        editorHighlights,
        vscode.commands.registerCommand('references-view.find', findCommand),
        vscode.commands.registerCommand('references-view.refind', refindCommand),
        vscode.commands.registerCommand('references-view.refresh', refreshCommand),
        vscode.commands.registerCommand('references-view.clear', clearCommand),
        vscode.commands.registerCommand('references-view.show', showRefCommand),
        vscode.commands.registerCommand('references-view.remove', removeRefCommand),
        vscode.commands.registerCommand('references-view.showNextReference', () => moveCommand(true)),
        vscode.commands.registerCommand('references-view.showPrevReference', () => moveCommand(false)),
    );
}
