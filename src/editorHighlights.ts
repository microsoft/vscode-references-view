/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Model } from './model';

export class EditorHighlights {

    private _decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        overviewRulerLane: vscode.OverviewRulerLane.Center
    });

    private _model?: Model;

    setModel(model: Model): void {
        this._model = model;
    }

    show() {
        const { activeTextEditor: editor } = vscode.window;
        if (!editor || !this._model) {
            return;
        }
        const item = this._model.get(editor.document.uri);
        if (item) {
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
