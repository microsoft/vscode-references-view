/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Model, FileItem } from './model';

export class EditorHighlights {

    private readonly _decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        overviewRulerLane: vscode.OverviewRulerLane.Center
    });

    private _model?: Model;
    private _modelListener?: vscode.Disposable;
    private _ignore = new Set<FileItem>();

    setModel(model?: Model): void {
        this._model = model;
        this._ignore.clear();
        if (this._modelListener) {
            this._modelListener.dispose();
        }
        if (model) {
            this.show();
            this._modelListener = vscode.workspace.onDidChangeTextDocument(e => {
                // add those items that have been changed to a 
                // ignore list so that we won't update decorations
                // for them again
                this._ignore.add(model.get(e.document.uri)!);
            });
        } else {
            this.hide();
        }
    }

    show() {
        const { activeTextEditor: editor } = vscode.window;
        if (!editor || !this._model) {
            return;
        }
        const item = this._model.get(editor.document.uri);
        if (item && !this._ignore.has(item)) {
            editor.setDecorations(this._decorationType, item.results.map(ref => ref.location.range));
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
