/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CallItem, CallsModel, FileItem, ReferencesModel } from './models';
import { TreeItem } from './provider';

export class EditorHighlights {

    private readonly _decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    });

    private _model?: ReferencesModel | CallsModel;
    private _listener?: vscode.Disposable;
    private _ignore = new Set<FileItem | undefined>();

    constructor(private readonly _view: vscode.TreeView<TreeItem>) { }

    setModel(model?: ReferencesModel | CallsModel): void {
        this._model = model;
        this._ignore.clear();
        if (this._listener) {
            this._listener.dispose();
        }

        if (model instanceof ReferencesModel) {
            this._listener = vscode.workspace.onDidChangeTextDocument(async e => {
                // add those items that have been changed to a 
                // ignore list so that we won't update decorations
                // for them again
                this._ignore.add(await model.get(e.document.uri));
            });

        } else if (model instanceof CallsModel) {
            this._listener = this._view.onDidChangeSelection(() => {
                this.show();
            });
        }

        this.show();
    }

    async show() {
        const { activeTextEditor: editor } = vscode.window;
        if (editor) {
            const ranges: vscode.Range[] = [];
            if (this._model instanceof ReferencesModel) {
                const item = await this._model.get(editor.document.uri);
                if (item && !this._ignore.has(item)) {
                    ranges.push(...item.results.map(ref => ref.location.range));
                }
            } else if (this._model instanceof CallsModel) {
                const [sel] = this._view.selection;
                if (sel instanceof CallItem) {
                    let locations = sel.locations;
                    if (!locations) {
                        locations = [new vscode.Location(sel.item.uri, sel.item.selectionRange)];
                    }
                    for (const loc of locations) {
                        if (loc.uri.toString() === editor.document.uri.toString()) {
                            ranges.push(loc.range);
                        }
                    }
                }
            }
            editor.setDecorations(this._decorationType, ranges);
        }
    }

    hide() {
        const { activeTextEditor: editor } = vscode.window;
        if (editor) {
            editor.setDecorations(this._decorationType, []);
        }
    }

    refresh() {
        this.hide();
        this.show();
    }
}
