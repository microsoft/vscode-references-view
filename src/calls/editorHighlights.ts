/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Call } from './model';
import { TreeObject } from './provider';

export class EditorHighlights {

    private readonly _decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    });

    constructor(readonly view: vscode.TreeView<TreeObject>) { }

    show() {
        const { activeTextEditor: editor } = vscode.window;
        if (!editor) {
            return;
        }
        const [sel] = this.view.selection;
        if (!(sel instanceof Call)) {
            return
        }
        const call = sel;

        if (call.locations) {
            const ranges: vscode.Range[] = [];
            for (const loc of call.locations) {
                if (loc.uri.toString() === editor.document.uri.toString()) {
                    ranges.push(loc.range);
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
