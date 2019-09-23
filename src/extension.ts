/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { History, HistoryItem } from './history';
import { Model, ReferenceItem, FileItem, FolderItem } from './model';
import { DataProvider, getPreviewChunks } from './provider';
import { EditorHighlights } from './editorHighlights';

export function activate(context: vscode.ExtensionContext) {

    const viewId = 'references-view.tree';
    const history = new History();
    const provider = new DataProvider(history);

    const view = vscode.window.createTreeView(viewId, {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    // editor highlights
    const editorHighlights = new EditorHighlights();
    vscode.window.onDidChangeActiveTextEditor(() => view.visible && editorHighlights.show(), context.subscriptions);
    view.onDidChangeVisibility(e => e.visible ? editorHighlights.show() : editorHighlights.hide(), context.subscriptions);

    // current active model
    let model: Model | undefined;

    const showNoResult = () => {
        let message: string;
        if (history.isEmpty) {
            message = 'No results found.';
        } else {
            message = 'No results found. Run a previous search again:';
        }
        view.message = message;
    };

    const updateTotals = () => {
        if (model) {
            const totalFiles = model.totalFiles;
            const totalRefs = model.totalRefs;
            if (totalRefs === 1 && totalFiles === 1) {
                view.message = `${totalRefs} result in ${totalFiles} file`;
            } else if (model.totalRefs === 1) {
                view.message = `${totalRefs} result in ${totalFiles} files`;
            } else if (totalFiles === 1) {
                view.message = `${totalRefs} results in ${totalFiles} file`;
            } else {
                view.message = `${totalRefs} results in ${totalFiles} files`;
            }
        }
    }

    const updateModel = async (createModel: () => Promise<Model | undefined> | undefined): Promise<Model | void> => {
        // upon first interaction set the reference list as active and reveal it
        await vscode.commands.executeCommand('setContext', 'reference-list.isActive', true)
        vscode.commands.executeCommand(`${viewId}.focus`);

        // remove existing highlights
        editorHighlights.setModel(undefined);
        view.message = undefined;

        const modelCreation = createModel();

        // the model creation promise is passed to the provider so that the
        // tree view can indicate loading, for everthing else we need to wait
        // for the model to be resolved
        provider.setModelCreation(modelCreation);

        if (!modelCreation) {
            return showNoResult();
        }

        // wait for model, update context and UI
        model = await modelCreation;
        vscode.commands.executeCommand('setContext', 'reference-list.hasResult', Boolean(model));

        if (!model || model.isEmpty) {
            return showNoResult();
        }

        // update editor
        editorHighlights.setModel(model);

        // udate tree
        const selection = model.first();
        if (selection && view.visible) {
            view.reveal(selection, { select: true, focus: true });
        }

        // update message
        updateTotals();

        return model;
    }

    const findCommand = async (uri?: vscode.Uri, position?: vscode.Position) => {
        const model = await updateModel(() => {
            if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
                // trust args if correct'ish
                return Model.create(uri, position);

            } else if (vscode.window.activeTextEditor) {
                // take args from active editor
                let editor = vscode.window.activeTextEditor;
                if (editor.document.getWordRangeAtPosition(editor.selection.active)) {
                    return Model.create(editor.document.uri, editor.selection.active);
                }
            }
            return undefined;
        });

        if (model) {
            // update history
            history.add(model);
            vscode.commands.executeCommand('setContext', 'reference-list.hasHistory', true);
        }
    };

    const refindCommand = (item: HistoryItem) => {
        if (item instanceof HistoryItem) {
            return findCommand(item.uri, item.position);
        }
    }

    const refreshCommand = async () => {
        if (model) {
            return findCommand(model.uri, model.position);
        }
    }

    const clearResult = () => {
        vscode.commands.executeCommand('setContext', 'reference-list.hasResult', false);
        editorHighlights.setModel(undefined);
        provider.setModelCreation(undefined);
    }

    const clearCommand = async () => {
        clearResult();

        let lis = provider.onDidReturnEmpty(() => {
            lis.dispose();
            view.message = `To populate this view, open an editor and run the 'Find All References'-command or run a previous search again:`;
        });
    }

    const clearHistoryCommand = async () => {
        clearResult();
        history.clear();
        showNoResult();

        vscode.commands.executeCommand('setContext', 'reference-list.hasHistory', false);
    }

    const showRefCommand = (arg?: ReferenceItem | HistoryItem | any, focusEditor?: boolean) => {
        if (arg instanceof ReferenceItem) {
            const { location } = arg;
            vscode.window.showTextDocument(location.uri, {
                selection: location.range.with({ end: location.range.start }),
                preserveFocus: !focusEditor
            });

        } else if (arg instanceof HistoryItem) {
            vscode.window.showTextDocument(arg.uri, {
                selection: new vscode.Range(arg.position, arg.position),
                preserveFocus: false
            });
        }
    };

    const removeRefCommand = (arg?: ReferenceItem | any) => {
        if (model) {
            const next = arg.move(true);
            model.remove(arg);
            editorHighlights.refresh();
            updateTotals();
            if (next) {
                view.reveal(next, { select: true });
            }
        }
    };

    const focusRefCommand = (fwd: boolean) => {
        if (!model) {
            return;
        }
        const selection = view.selection[0] || model.first();
        if (selection instanceof HistoryItem) {
            return;
        }
        const next = selection.move(fwd);
        if (next) {
            view.reveal(next, { select: true });
            showRefCommand(next, true);
        }
    };

    const copyCommand = async (arg?: ReferenceItem | FileItem | Model | any | undefined) => {
        let val = '';
        let stack = [arg];
        while (stack.length > 0) {
            let item = stack.pop();
            if (item instanceof Model) {
                let counter = 0;
                for (let file of item.allFiles()) {
                    stack.push(file);
                    counter++;
                    if (counter === 100) break;
                }
            } else if (item instanceof ReferenceItem) {
                let doc = await item.parent.getDocument()
                let chunks = getPreviewChunks(doc, item.location.range, 21, false);
                val += `  ${item.location.range.start.line + 1},${item.location.range.start.character + 1}:${chunks.before + chunks.inside + chunks.after}\n`;

            } else if (item instanceof FileItem) {
                val += `${vscode.workspace.asRelativePath(item.uri)}\n`;
                stack.push(...item.results);
            }
        }
        if (val) {
            await vscode.env.clipboard.writeText(val);
        }
    };

    const copyPathCommand = (arg?: FileItem) => {
        if (arg instanceof FileItem) {
            if (arg.uri.scheme === 'file') {
                vscode.env.clipboard.writeText(arg.uri.fsPath);
            } else {
                vscode.env.clipboard.writeText(arg.uri.toString(true));
            }
        }
    };

    const showHistryPicks = async () => {
        interface HistoryPick extends vscode.QuickPickItem {
            item: HistoryItem
        }
        const picks = [...history].map(item => <HistoryPick>{
            label: item.word,
            description: `${vscode.workspace.asRelativePath(item.uri)} • ${item.line}`,
            item
        });
        const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Select previous reference search' });
        if (pick) {
            await refindCommand(pick.item);
        }
    };

    const showReferences = async (uri: vscode.Uri, position: vscode.Position, locations: vscode.Location[]) => {
        await updateModel(() => {
            return Promise.resolve(new Model(uri, position, locations, Model.getDefaultConfiguration()));
        });
    };
    let showReferencesDisposable: vscode.Disposable | undefined;
    const config = 'references.preferredLocation';
    function updateShowReferences(event?: vscode.ConfigurationChangeEvent) {
        if (event && !event.affectsConfiguration(config)) {
            return;
        }
        const value = vscode.workspace.getConfiguration().get<string>(config);
        if (showReferencesDisposable) {
            showReferencesDisposable.dispose();
            showReferencesDisposable = undefined;
        }
        if (value === 'view') {
            showReferencesDisposable = vscode.commands.registerCommand('editor.action.showReferences', showReferences);
        }
    };
    updateShowReferences();

    context.subscriptions.push(
        view,
        vscode.workspace.onDidChangeConfiguration(updateShowReferences),
        vscode.commands.registerCommand('references-view.find', findCommand),
        vscode.commands.registerCommand('references-view.refind', refindCommand),
        vscode.commands.registerCommand('references-view.refresh', refreshCommand),
        vscode.commands.registerCommand('references-view.clear', clearCommand),
        vscode.commands.registerCommand('references-view.clearHistory', clearHistoryCommand),
        vscode.commands.registerCommand('references-view.show', showRefCommand),
        vscode.commands.registerCommand('references-view.remove', removeRefCommand),
        vscode.commands.registerCommand('references-view.next', () => focusRefCommand(true)),
        vscode.commands.registerCommand('references-view.prev', () => focusRefCommand(false)),
        vscode.commands.registerCommand('references-view.copy', copyCommand),
        vscode.commands.registerCommand('references-view.copyAll', () => copyCommand(model)),
        vscode.commands.registerCommand('references-view.copyPath', copyPathCommand),
        vscode.commands.registerCommand('references-view.pickFromHistory', showHistryPicks),
    );
}
