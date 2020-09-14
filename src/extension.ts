/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { EditorHighlights } from './editorHighlights';
import { History, HistoryItem } from './history';
import { CallItem, CallsDirection, CallsModel, Context, FileItem, getPreviewChunks, getRequestRange, ItemSource, ReferenceItem, ReferencesModel, RichCallsDirection } from './models';
import { TreeDataProviderWrapper, TreeItem } from './provider';

export function activate(context: vscode.ExtensionContext) {

    const callsDirection = new RichCallsDirection(context.globalState);
    const history = new History();
    const provider = new TreeDataProviderWrapper<TreeItem>();

    const viewId = 'references-view.tree';

    const revealView = async () => {
        // upon first interaction set the reference list as active and reveal it
        await Context.IsActive.set(true);
        await vscode.commands.executeCommand(`${viewId}.focus`);
    };

    const view = vscode.window.createTreeView<FileItem | ReferenceItem | CallItem>(viewId, {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    // editor highlights
    const editorHighlights = new EditorHighlights(view);
    vscode.window.onDidChangeActiveTextEditor(() => view.visible && editorHighlights.show(), undefined, context.subscriptions);
    view.onDidChangeVisibility(e => e.visible ? editorHighlights.show() : editorHighlights.hide(), undefined, context.subscriptions);

    // current active model
    let model: ReferencesModel | CallsModel | undefined;

    const updateModel = async (newModel: ReferencesModel | CallsModel | undefined) => {
        model = newModel;

        // update state
        view.message = undefined;
        editorHighlights.setModel(model);

        // update context
        Context.HasResult.set(Boolean(model));
        Context.Source.set(model?.source);

        revealView();
        provider.update(newModel || history);

        if (newModel) {
            await showResultsMessage();
        } else {
            showNoResultsMessage();
        }
    };

    const showNoResultsMessage = () => {
        let message: string;
        if (history.isEmpty) {
            message = 'No results.';
        } else {
            message = 'No results. Try running a previous search again:';
        }
        view.message = message;
        view.title = 'Results';
    };

    const showResultsMessage = async () => {
        if (model instanceof ReferencesModel) {

            const total = await model.total();
            const files = (await model.items).length;

            // update message
            if (total === 1 && files === 1) {
                view.message = `${total} result in ${files} file`;
            } else if (total === 1) {
                view.message = `${total} result in ${files} files`;
            } else if (files === 1) {
                view.message = `${total} results in ${files} file`;
            } else {
                view.message = `${total} results in ${files} files`;
            }

            // update title
            if (model.source === ItemSource.References) {
                view.title = `Results (${total})`;
            } else if (model.source === ItemSource.Implementations) {
                view.title = `Implementations (${total})`;
            }

        } else if (model instanceof CallsModel) {
            // update title
            if (model.direction === CallsDirection.Incoming) {
                view.title = 'Callers Of';
            } else {
                view.title = 'Calls From';
            }
            view.message = '';

        } else {
            view.message = undefined;
            view.title = 'Results';
        }
    };

    const updateReferencesModel = async (model?: ReferencesModel) => {

        // wait for model, update context and UI
        await updateModel(model);

        if (model) {
            // bail out when having no results...
            if ((await model.items).length === 0) {
                await updateModel(undefined);
                return;
            }
            // reveal
            const selection = await model.first();
            if (selection && view.visible) {
                view.reveal(selection, { select: true, focus: true });
            }
            // add to history
            history.add(await model.asHistoryItem([model.source]));
        }
    };

    const findReferencesCommand = async (source: ItemSource, uri?: vscode.Uri, position?: vscode.Position) => {
        let model: ReferencesModel | undefined;
        if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
            // trust args if correct'ish
            model = ReferencesModel.create(uri, position, source);

        } else if (vscode.window.activeTextEditor) {
            // take args from active editor
            let editor = vscode.window.activeTextEditor;
            if (getRequestRange(editor.document, editor.selection.active)) {
                model = ReferencesModel.create(editor.document.uri, editor.selection.active, source);
            }
        }
        updateReferencesModel(model);
    };

    const refindCommand = (item: HistoryItem) => {
        if (item instanceof HistoryItem) {
            vscode.commands.executeCommand(item.commandId, ...[...item.extraArgs, item.uri, item.anchor.getPosition()]);
        }
    };

    const refreshCommand = async () => {
        const [last] = history;
        if (last) {
            refindCommand(last);
        }
    };

    const updateCallHierachyModel = async (direction = callsDirection.value, uri?: vscode.Uri, position?: vscode.Position) => {

        let model: CallsModel | undefined;

        if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
            // trust args if correct'ish
            model = new CallsModel(uri, position, direction);

        } else if (vscode.window.activeTextEditor) {
            // take args from active editor
            let editor = vscode.window.activeTextEditor;
            if (getRequestRange(editor.document, editor.selection.active)) {
                model = new CallsModel(editor.document.uri, editor.selection.active, direction);
            }
        }

        await updateModel(model);

        if (model instanceof CallsModel) {
            if (await model.isEmpty()) {
                await updateModel(undefined);
                return;
            }
            // reveal
            const selection = await model.first();
            if (selection && view.visible) {
                view.reveal(selection, { select: true, focus: true, expand: true });
            }
            // add to history
            history.add(await model.asHistoryItem([model.direction]));
        }
    };

    const setCallHierarchyDirectionCommand = async (direction: CallsDirection, arg: any) => {
        callsDirection.value = direction;
        if (arg instanceof CallItem) {
            return updateCallHierachyModel(direction, arg.item.uri, arg.item.selectionRange.start);

        } else if (model instanceof CallsModel) {
            return updateCallHierachyModel(direction, model.uri, model.position);
        }
    };

    const clearCommand = async () => {
        await updateModel(undefined);
    };

    const clearHistoryCommand = async () => {
        history.clear();
        await updateModel(undefined);
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
            pos = arg.anchor.getPosition();
            preserveFocus = false;
        }

        if (uri && pos) {
            return vscode.commands.executeCommand('vscode.open', uri, {
                selection: new vscode.Range(pos, pos),
                preserveFocus
            });
        }
    };

    const removeRefCommand = async (arg?: ReferenceItem | FileItem | CallItem | any) => {
        if (model instanceof ReferencesModel) {
            let next: ReferenceItem | undefined;
            if (arg instanceof ReferenceItem) {
                next = await model.move(arg, true);
                if (next?.parent !== arg.parent) {
                    next = undefined;
                }
            }
            await model.remove(arg);
            editorHighlights.refresh();
            showResultsMessage();
            if (next) {
                view.reveal(next, { select: true });
            }
        } else if (model instanceof CallsModel) {
            const item = arg as CallItem;
            const next = await model.move(item, true);
            await model.remove(item);

            if (await model.isEmpty()) {
                return clearCommand();
            }

            editorHighlights.refresh();
            showResultsMessage();
            if (next) {
                view.reveal(next, { select: true });
            } else if (item.parent) {
                view.reveal(item.parent, { select: true });
            }
        }
    };

    const focusRefCommand = async (fwd: boolean) => {
        if (!(model instanceof ReferencesModel)) {
            return;
        }
        const selection = view.selection[0] || model.first();
        if (selection instanceof HistoryItem || selection instanceof CallItem) {
            return;
        }
        const next = await model.move(selection, fwd);
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
                stack.push(...(await item.items).slice(0, 99));

            } else if (item instanceof ReferenceItem) {
                let doc = await item.getDocument();
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
            refindCommand(pick.item);
        }
    };

    const showReferences = async (uri: vscode.Uri, position: vscode.Position, locations: vscode.Location[]) => {
        await updateReferencesModel(new ReferencesModel(ItemSource.References, uri, position, Promise.resolve(locations)));
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
        vscode.commands.registerCommand('references-view.showCallHierarchy', () => updateCallHierachyModel()),
        vscode.commands.registerCommand('references-view.showOutgoingCalls', (arg) => setCallHierarchyDirectionCommand(CallsDirection.Outgoing, arg)),
        vscode.commands.registerCommand('references-view.showIncomingCalls', (arg) => setCallHierarchyDirectionCommand(CallsDirection.Incoming, arg)),
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
