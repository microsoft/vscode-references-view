/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FileItem, ReferenceItem, Model } from './model';

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

type TreeObject = FileItem | ReferenceItem;

export class DataProvider implements vscode.TreeDataProvider<TreeObject> {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeObject>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly _onDidReturnEmpty = new vscode.EventEmitter<this>();
    readonly onDidReturnEmpty = this._onDidReturnEmpty.event;

    private _modelCreation?: Promise<Model | undefined>;
    private _modelListener?: vscode.Disposable;

    setModelCreation(modelCreation?: Promise<Model | undefined>) {
        if (this._modelListener) {
            this._modelListener.dispose();
        }
        this._modelCreation = modelCreation;
        this._onDidChangeTreeData.fire();

        if (modelCreation) {
            modelCreation.then(model => {
                if (model && modelCreation === this._modelCreation) {
                    this._modelListener = model.onDidChange(e => this._onDidChangeTreeData.fire(e instanceof FileItem ? e : undefined));
                }
            })
        }
    }

    async getTreeItem(element: TreeObject): Promise<vscode.TreeItem> {

        if (element instanceof FileItem) {
            // files
            const result = new vscode.TreeItem(element.uri);
            result.contextValue = 'file-item'
            result.description = true;
            result.iconPath = vscode.ThemeIcon.File;
            result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            return result;
        }

        if (element instanceof ReferenceItem) {
            // references
            const { range } = element.location;
            const doc = await element.parent.getDocument(true);

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
        if (!this._modelCreation) {
            this._onDidReturnEmpty.fire(this);
        }
        if (element instanceof FileItem) {
            return element.results;
        } else if (this._modelCreation) {
            const model = await this._modelCreation;
            return model ? model.items : [];
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
