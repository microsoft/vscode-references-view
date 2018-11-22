/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { History } from './history';
import { Model, ReferenceItem } from './model';
import { DataProvider } from './provider';
import { EditorHighlights } from './editorHighlights';

export function activate(context: vscode.ExtensionContext) {

    const viewId = 'references-view.tree';
    const history = new History();
    const provider = new DataProvider();

    const view = vscode.window.createTreeView(viewId, {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    // editor highlights
    const editorHighlights = new EditorHighlights();
    vscode.window.onDidChangeActiveTextEditor(editorHighlights.show, editorHighlights, context.subscriptions);
    view.onDidChangeVisibility(e => e.visible ? editorHighlights.show() : editorHighlights.hide(), context.subscriptions);

    const findCommand = async (uri?: vscode.Uri, position?: vscode.Position) => {
        // upon first interaction set the reference list as active
        // which will reveal it
        vscode.commands.executeCommand('setContext', 'reference-list.isActive', true)

        // remove existing highlights
        editorHighlights.hide();
        view.message = undefined;

        let model: Model | undefined = undefined;
        if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
            // trust args if correct'ish
            model = new Model(uri, position);

        } else if (vscode.window.activeTextEditor) {
            let editor = vscode.window.activeTextEditor;
            if (editor.document.getWordRangeAtPosition(editor.selection.active)) {
                model = new Model(editor.document.uri, editor.selection.active);
            }
        }

        if (model) {
            provider.setModel(model);
            history.add(model);

            await model.resolve;

            // update editor
            editorHighlights.setModel(model);
            editorHighlights.show();

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
        const model = provider.getModel();
        if (model) {
            model.reset();
            provider._onDidChangeTreeData.fire();
            await model.resolve
            editorHighlights.refresh();
            view.reveal(view.selection[0]);
        }
    }

    const clearCommand = async () => {
        editorHighlights.hide();
        provider.setModel(undefined);

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
        const model = provider.getModel();
        if (model) {
            const next = model.move(arg, true);
            const parent = model.remove(arg);
            provider._onDidChangeTreeData.fire(parent);
            editorHighlights.refresh();
            if (next) {
                view.reveal(next, { select: true });
            }
        }
    };

    const moveCommand = (fwd: boolean) => {
        const model = provider.getModel();
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
