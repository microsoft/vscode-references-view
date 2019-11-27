/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { EditorHighlights } from './editorHighlights';
import { History, HistoryItem } from './history';
import { CallItem, CallsDirection, CallsModel, FileItem, getPreviewChunks, ItemSource, ReferenceItem, ReferencesModel, RichCallsDirection } from './models';
import { CallItemDataProvider, HistoryDataProvider, ReferencesProvider, TreeDataProviderWrapper, TreeItem } from './provider';

export function activate(context: vscode.ExtensionContext) {

    const callsDirection = new RichCallsDirection(context.globalState);
    const history = new History();
    const historyProvider = new HistoryDataProvider(history);
    const provider = new TreeDataProviderWrapper<TreeItem>();

    const viewId = 'references-view.tree';

    const revealView = async () => {
        // upon first interaction set the reference list as active and reveal it
        await vscode.commands.executeCommand('setContext', 'reference-list.isActive', true);
        await vscode.commands.executeCommand(`${viewId}.focus`);
    };

    const view = vscode.window.createTreeView(viewId, {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    // editor highlights
    const editorHighlights = new EditorHighlights();
    vscode.window.onDidChangeActiveTextEditor(() => view.visible && editorHighlights.show(), undefined, context.subscriptions);
    view.onDidChangeVisibility(e => e.visible ? editorHighlights.show() : editorHighlights.hide(), undefined, context.subscriptions);

    // current active model
    let model: ReferencesModel | CallsModel | undefined;

    const showNoResultsMessage = () => {
        let message: string;
        if (history.isEmpty) {
            message = 'No results found.';
        } else {
            message = 'No results found. Run a previous search again:';
        }
        view.message = message;
    };

    const showResultsMessage = () => {
        if (model instanceof ReferencesModel) {
            if (model.total === 1 && model.items.length === 1) {
                view.message = `${model.total} result in ${model.items.length} file`;
            } else if (model.total === 1) {
                view.message = `${model.total} result in ${model.items.length} files`;
            } else if (model.items.length === 1) {
                view.message = `${model.total} results in ${model.items.length} file`;
            } else {
                view.message = `${model.total} results in ${model.items.length} files`;
            }
        } else {
            view.message = undefined;
        }
    };

    const updateModel = async (createModel: () => Promise<ReferencesModel | undefined> | undefined): Promise<ReferencesModel | void> => {
        revealView();

        // remove existing highlights
        editorHighlights.setModel(undefined);
        view.message = undefined;

        const modelCreation = createModel();

        if (!modelCreation) {
            return showNoResultsMessage();
        }

        // the model creation promise is passed to the provider so that the
        // tree view can indicate loading, for everthing else we need to wait
        // for the model to be resolved
        provider.update(new ReferencesProvider(modelCreation));

        // wait for model, update context and UI
        model = await modelCreation;
        vscode.commands.executeCommand('setContext', 'reference-list.hasResult', Boolean(model));
        vscode.commands.executeCommand('setContext', 'reference-list.source', model && model.source);

        if (!model || model.items.length === 0) {
            return showNoResultsMessage();
        }

        if (history.add(await model.asHistoryItem([model.source, model.uri, model.position]))) {
            vscode.commands.executeCommand('setContext', 'reference-list.hasHistory', true);
        }

        // update title
        if (model.source === ItemSource.References) {
            view.title = `Results (${model.total})`;
        } else if (model.source === ItemSource.Implementations) {
            view.title = `Implementations (${model.total})`;
        }

        // update editor
        editorHighlights.setModel(model);

        // udate tree
        const selection = model.first();
        if (selection && view.visible) {
            view.reveal(selection, { select: true, focus: true });
        }

        // update message
        showResultsMessage();

        return model;
    };

    const findReferencesCommand = async (source: ItemSource, uri?: vscode.Uri, position?: vscode.Position) => {
        return await updateModel(() => {
            if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
                // trust args if correct'ish
                return ReferencesModel.create(uri, position, source);

            } else if (vscode.window.activeTextEditor) {
                // take args from active editor
                let editor = vscode.window.activeTextEditor;
                if (editor.document.getWordRangeAtPosition(editor.selection.active)) {
                    return ReferencesModel.create(editor.document.uri, editor.selection.active, source);
                }
            }
            return undefined;
        });
    };

    const refindCommand = (item: HistoryItem) => {
        if (item instanceof HistoryItem) {
            vscode.commands.executeCommand(item.command.command, ...item.command.arguments!);
        }
    };

    const refreshCommand = async () => {
        const [last] = history;
        if (last) {
            refindCommand(last);
        }
    };

    const showCallHierarchyCommand = async (uri?: vscode.Uri, position?: vscode.Position, direction = callsDirection.value) => {
        revealView();

        if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
            // trust args if correct'ish
            model = new CallsModel(uri, position, direction);

        } else if (vscode.window.activeTextEditor) {
            // take args from active editor
            let editor = vscode.window.activeTextEditor;
            if (editor.document.getWordRangeAtPosition(editor.selection.active)) {
                model = new CallsModel(editor.document.uri, editor.selection.active, direction);
            }
        }
        if (model instanceof CallsModel) {
            vscode.commands.executeCommand('setContext', 'reference-list.hasResult', true);
            vscode.commands.executeCommand('setContext', 'reference-list.source', 'callHierarchy');

            provider.update(new CallItemDataProvider(model));
            showResultsMessage();
            view.title = model.direction === CallsDirection.Incoming ? 'Callers Of' : 'Calls From';
            if (history.add(await model.asHistoryItem([uri, position, direction]))) {
                vscode.commands.executeCommand('setContext', 'reference-list.hasHistory', true);
            }
        }
    };

    const setCallHierarchyDirectionCommand = async (direction: CallsDirection) => {
        callsDirection.value = direction;
        if (model instanceof CallsModel) {
            showCallHierarchyCommand(model.uri, model.position, direction);
        }
    };

    const makeRootCommand = (call: any) => {
        if (call instanceof CallItem) {
            return showCallHierarchyCommand(call.item.uri, call.item.selectionRange.start);
        }
    };

    const clearResult = () => {
        vscode.commands.executeCommand('setContext', 'reference-list.hasResult', false);
        vscode.commands.executeCommand('setContext', 'reference-list.source', undefined);
        view.title = 'Results';
        editorHighlights.setModel(undefined);
        provider.update(historyProvider);
    };

    const clearCommand = async () => {
        clearResult();

        view.message = `To populate this view, open an editor and run the 'Find All References'-command or run a previous search again`;
        provider.update(historyProvider);
    };

    const clearHistoryCommand = async () => {
        clearResult();
        history.clear();
        showNoResultsMessage();

        vscode.commands.executeCommand('setContext', 'reference-list.hasHistory', false);
    };

    const showItemCommand = (arg?: ReferenceItem | HistoryItem | CallItem | any, focusEditor?: boolean) => {

        let uri: vscode.Uri | undefined;
        let pos: vscode.Position | undefined;
        let preserveFocus = !focusEditor;

        if (arg instanceof ReferenceItem) {
            const { location } = arg;
            uri = location.uri;
            pos = location.range.start;

        } else if (arg instanceof CallItem) {
            uri = arg.item.uri;
            pos = arg.item.selectionRange.start;

        } else if (arg instanceof HistoryItem) {
            uri = arg.uri;
            pos = arg.position;
            preserveFocus = false;
        }

        if (uri && pos) {
            vscode.window.showTextDocument(uri, {
                selection: new vscode.Range(pos, pos),
                preserveFocus
            });
        }
    };

    const removeRefCommand = (arg?: ReferenceItem | any) => {
        if (model instanceof ReferencesModel) {
            const next = model.move(arg, true);
            model.remove(arg);
            editorHighlights.refresh();
            showResultsMessage();
            if (next) {
                view.reveal(next, { select: true });
            }
        }
    };

    const focusRefCommand = (fwd: boolean) => {
        if (!(model instanceof ReferencesModel)) {
            return;
        }
        const selection = view.selection[0] || model.first();
        if (selection instanceof HistoryItem || selection instanceof CallItem) {
            return;
        }
        const next = model.move(selection, fwd);
        if (next) {
            view.reveal(next, { select: true });
            showItemCommand(next, true);
        }
    };

    const copyCommand = async (arg?: ReferenceItem | FileItem | ReferencesModel | any | undefined) => {
        let val = '';
        let stack = [arg];
        while (stack.length > 0) {
            let item = stack.pop();
            if (item instanceof ReferencesModel) {
                stack.push(...item.items.slice(0, 99));

            } else if (item instanceof ReferenceItem) {
                let doc = await item.parent.getDocument();
                let chunks = getPreviewChunks(doc, item.location.range, 21, false);
                val += `  ${item.location.range.start.line + 1}, ${item.location.range.start.character + 1}: ${chunks.before + chunks.inside + chunks.after} \n`;

            } else if (item instanceof FileItem) {
                val += `${vscode.workspace.asRelativePath(item.uri)} \n`;
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
            item: HistoryItem;
        }
        const picks = [...history].map(item => <HistoryPick>{
            label: item.label,
            description: item.description,
            item
        });
        const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Select previous reference search' });
        if (pick) {
            await refindCommand(pick.item);
        }
    };

    const showReferences = async (uri: vscode.Uri, position: vscode.Position, locations: vscode.Location[]) => {
        await updateModel(() => {
            return Promise.resolve(new ReferencesModel(ItemSource.References, uri, position, locations));
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
        vscode.commands.registerCommand('references-view.find', () => findReferencesCommand(ItemSource.References)),
        vscode.commands.registerCommand('references-view.findImplementations', () => findReferencesCommand(ItemSource.Implementations)),
        vscode.commands.registerCommand('references-view.refindReference', findReferencesCommand),
        vscode.commands.registerCommand('references-view.showCallHierarchy', showCallHierarchyCommand),
        vscode.commands.registerCommand('references-view.showOutgoingCalls', () => setCallHierarchyDirectionCommand(CallsDirection.Outgoing)),
        vscode.commands.registerCommand('references-view.showIncomingCalls', () => setCallHierarchyDirectionCommand(CallsDirection.Incoming)),
        vscode.commands.registerCommand('references-view.rerunCallHierarchy', makeRootCommand),
        vscode.commands.registerCommand('references-view.refind', refindCommand),
        vscode.commands.registerCommand('references-view.refresh', refreshCommand),
        vscode.commands.registerCommand('references-view.clear', clearCommand),
        vscode.commands.registerCommand('references-view.clearHistory', clearHistoryCommand),
        vscode.commands.registerCommand('references-view.show', showItemCommand),
        vscode.commands.registerCommand('references-view.remove', removeRefCommand),
        vscode.commands.registerCommand('references-view.next', () => focusRefCommand(true)),
        vscode.commands.registerCommand('references-view.prev', () => focusRefCommand(false)),
        vscode.commands.registerCommand('references-view.copy', copyCommand),
        vscode.commands.registerCommand('references-view.copyAll', () => copyCommand(model)),
        vscode.commands.registerCommand('references-view.copyPath', copyPathCommand),
        vscode.commands.registerCommand('references-view.pickFromHistory', showHistryPicks),
    );

}
