/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FileItem, ReferenceItem, Model, FolderItem } from './model';
import { History, HistoryItem } from './history';

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
    return { before, inside, after }
}

export type TreeObject = FileItem | FolderItem | ReferenceItem | HistoryItem;

export class DataProvider implements vscode.TreeDataProvider<TreeObject> {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeObject>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly _onDidReturnEmpty = new vscode.EventEmitter<this>();
    readonly onDidReturnEmpty = this._onDidReturnEmpty.event;

    private readonly _history: History;
    private _modelCreation?: Promise<Model | undefined>;
    private _modelListener?: vscode.Disposable;

    constructor(history: History) {
        this._history = history;
    }

    setModelCreation(modelCreation?: Promise<Model | undefined>) {
        if (this._modelListener) {
            this._modelListener.dispose();
        }
        this._modelCreation = modelCreation;
        this._onDidChangeTreeData.fire();

        if (modelCreation) {
            modelCreation.then(model => {
                if (model && modelCreation === this._modelCreation) {
                    this._modelListener = model.onDidChange(e => this._onDidChangeTreeData.fire(e.kind === 'file' ? e : undefined));
                }
            })
        }
    }

    async getTreeItem(element: TreeObject): Promise<vscode.TreeItem> {


        if (element.kind === 'file') {
            const result = new vscode.TreeItem(element.uri);
            result.contextValue = 'file-item'
            result.description = true;
            result.iconPath = vscode.ThemeIcon.File;
            result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            return result;
        } else if (element.kind === 'reference') {
            const { range } = element.location;
            const doc = await element.parent!.getDocument(true);

            const { before, inside, after } = getPreviewChunks(doc, range);

            const label: vscode.TreeItemLabel = {
                label: before + inside + after,
                highlights: [[before.length, before.length + inside.length]]
            };

            const result = new vscode.TreeItem2(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.contextValue = 'reference-item';
            result.command = {
                title: 'Open Reference',
                command: 'references-view.show',
                arguments: [element]
            }
            return result;
        } else if (element.kind === 'folder') {
            const result = new vscode.TreeItem(element.name);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.contextValue = 'folder-item';
            return result;
        } else if (element.kind === 'historyItem') {
            const result = new vscode.TreeItem(element.word);
            result.description = `${vscode.workspace.asRelativePath(element.uri)} • ${element.line}`;
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.contextValue = 'history-item';
            result.command = {
                title: 'Show Location',
                command: 'references-view.show',
                arguments: [element]
            }
            return result;
        }

        throw new Error();
    }

    async getChildren(element?: TreeObject | undefined): Promise<TreeObject[]> {
        if (element === undefined) {
            if (this._modelCreation) {
                const model = await this._modelCreation;
                if (!model || model.isEmpty) {
                    return [...this._history];
                } else {
                    return [...model.root.folders, ...model.root.files];
                }
            } else {
                return [...this._history];
            }
        } else {
            if (element.kind === 'file') {
                return element.references.slice(0);
            } else if (element.kind === 'folder') {
                return [...element.folders, ...element.files];
            } else {
                return [];
            }
        }
        
    }

    getParent(element: TreeObject): TreeObject | undefined {
        if (element.kind === 'file' || element.kind === 'folder') {
            return element.parent;
        } else if (element.kind === 'reference') {
            return element.parent;
        } else {
            return undefined;
        }
    }
}
