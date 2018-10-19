'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
class ReferenceSearchModel {
    constructor(document, position, items = new Set()) {
        this.document = document;
        this.position = position;
        this.items = items;
        //
    }
    get resolve() {
        if (!this._resolve) {
            this._resolve = this._doResolve();
        }
        return this._resolve;
    }
    reset() {
        this._resolve = undefined;
    }
    _doResolve() {
        return __awaiter(this, void 0, void 0, function* () {
            this.items.clear();
            const locations = yield vscode.commands.executeCommand('vscode.executeReferenceProvider', this.document.uri, this.position);
            if (locations) {
                let last;
                locations.sort(ReferenceSearchModel._compareLocations);
                for (const loc of locations) {
                    if (!last || last.uri.toString() !== loc.uri.toString()) {
                        last = new FileItem(loc.uri, new Set(), loc.uri.toString() === this.document.uri.toString());
                        this.items.add(last);
                    }
                    last.results.add(new ReferenceItem(loc, last));
                }
            }
            return this;
        });
    }
    remove(item) {
        if (item instanceof FileItem) {
            this.items.delete(item);
            return undefined;
        }
        else if (item instanceof ReferenceItem) {
            item.parent.results.delete(item);
            if (item.parent.results.size === 0) {
                this.items.delete(item.parent);
                return undefined;
            }
            else {
                return item.parent;
            }
        }
    }
    static _compareLocations(a, b) {
        if (a.uri.toString() < b.uri.toString()) {
            return -1;
        }
        else if (a.uri.toString() > b.uri.toString()) {
            return 1;
        }
        else if (a.range.start.isBeforeOrEqual(b.range.start)) {
            return -1;
        }
        else if (a.range.start.isAfter(b.range.start)) {
            return 1;
        }
        else {
            return 0;
        }
    }
}
class FileItem {
    constructor(uri, results, isFileOfRequest) {
        this.uri = uri;
        this.results = results;
        this.isFileOfRequest = isFileOfRequest;
    }
}
class ReferenceItem {
    constructor(location, parent) {
        this.location = location;
        this.parent = parent;
    }
}
class DataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    setModel(model) {
        this._model = model;
        this._onDidChangeTreeData.fire();
        vscode.commands.executeCommand('setContext', 'reference-list.hasResult', Boolean(this._model));
    }
    getModel() {
        return this._model;
    }
    getTreeItem(element) {
        return __awaiter(this, void 0, void 0, function* () {
            if (element instanceof FileItem) {
                let result;
                result = new vscode.TreeItem(element.uri);
                result.contextValue = 'reference-item';
                result.iconPath = vscode.ThemeIcon.File;
                result.collapsibleState = element.isFileOfRequest
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed;
                return result;
            }
            if (element instanceof ReferenceItem) {
                const { range } = element.location;
                const doc = yield vscode.workspace.openTextDocument(element.location.uri);
                let previewEnd = range.end.translate(0, 31);
                let previewStart = range.start.with({ character: Math.max(0, range.start.character - 8) });
                let wordRange = doc.getWordRangeAtPosition(previewStart);
                if (wordRange) {
                    previewStart = wordRange.start;
                }
                let label = `${doc.getText(new vscode.Range(previewStart, range.start))}'${doc.getText(range)}'${doc.getText(new vscode.Range(range.end, previewEnd))}`;
                let result;
                result = new vscode.TreeItem(label.trim());
                result.collapsibleState = vscode.TreeItemCollapsibleState.None;
                result.contextValue = 'reference-item';
                result.command = {
                    title: 'Open Reference',
                    command: 'references-view.show',
                    arguments: [element]
                };
                return result;
            }
            throw new Error();
        });
    }
    getChildren(element) {
        return __awaiter(this, void 0, void 0, function* () {
            if (element instanceof FileItem) {
                return [...element.results];
            }
            else if (this._model) {
                return [...(yield this._model.resolve).items];
            }
            else {
                return [];
            }
        });
    }
    getParent(element) {
        return element instanceof ReferenceItem
            ? element.parent
            : undefined;
    }
}
function activate(context) {
    const treeDataProvider = new DataProvider();
    const view = vscode.window.createTreeView('references-view.tree', { treeDataProvider });
    const findCommand = (editor) => __awaiter(this, void 0, void 0, function* () {
        if (editor.document.getWordRangeAtPosition(editor.selection.active)) {
            const model = new ReferenceSearchModel(editor.document, editor.selection.active);
            treeDataProvider.setModel(model);
            yield model.resolve;
            for (const item of model.items) {
                if (item.isFileOfRequest) {
                    view.reveal(item, { select: true, focus: true });
                }
            }
        }
    });
    const refreshCommand = () => {
        const model = treeDataProvider.getModel();
        if (model) {
            model.reset();
            treeDataProvider._onDidChangeTreeData.fire();
        }
    };
    const clearCommand = () => {
        treeDataProvider.setModel(undefined);
    };
    const showRefCommand = (arg) => {
        if (arg instanceof ReferenceItem) {
            const { location } = arg;
            vscode.window.showTextDocument(location.uri, { selection: location.range });
        }
    };
    const removeRefCommand = (arg) => {
        const model = treeDataProvider.getModel();
        if (model) {
            const parent = model.remove(arg);
            treeDataProvider._onDidChangeTreeData.fire(parent);
        }
    };
    context.subscriptions.push(view, vscode.commands.registerTextEditorCommand('references-view.find', findCommand), vscode.commands.registerTextEditorCommand('references-view.refresh', refreshCommand), vscode.commands.registerTextEditorCommand('references-view.clear', clearCommand), vscode.commands.registerCommand('references-view.show', showRefCommand), vscode.commands.registerCommand('references-view.remove', removeRefCommand));
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map