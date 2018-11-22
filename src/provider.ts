/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FileItem, ReferenceItem, Model } from './model';

type TreeObject = FileItem | ReferenceItem;

export function getPreviewChunks(doc: vscode.TextDocument, range: vscode.Range) {
    const previewStart = range.start.with({ character: Math.max(0, range.start.character - 8) });
    const wordRange = doc.getWordRangeAtPosition(previewStart);
    const before = doc.getText(new vscode.Range(wordRange ? wordRange.start : previewStart, range.start)).replace(/^\s*/g, '');
    const inside = doc.getText(range);
    const previewEnd = range.end.translate(0, 331);
    const after = doc.getText(new vscode.Range(range.end, previewEnd)).replace(/\s*$/g, '');
    return { before, inside, after }
}

export class DataProvider implements vscode.TreeDataProvider<TreeObject> {

    readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeObject>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _modelCreation?: Promise<Model | undefined>;

    set model(model: Promise<Model | undefined> | undefined) {
        this._modelCreation = model;
        this._onDidChangeTreeData.fire();
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
