/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CallsDirection, CallsModel, Call } from './model';
import { DataProvider } from './provider';
import { History, HistoryItem } from './history';
import { EditorHighlights } from './editorHighlights';

class RichCallsDirection {

    private static _key = 'calls-view.mode';

    constructor(
        private _mem: vscode.Memento,
        private _value: CallsDirection = CallsDirection.Incoming,
    ) {
        const raw = _mem.get<number>(RichCallsDirection._key);
        if (typeof raw === 'number' && raw >= 0 && raw <= 1) {
            this.value = raw;
        } else {
            this.value = _value;
        }
    }

    get value() {
        return this._value;
    }

    set value(value: CallsDirection) {
        this._value = value;
        vscode.commands.executeCommand('setContext', 'calls-view.mode', this._value === CallsDirection.Incoming ? 'showIncoming' : 'showOutgoing');
        this._mem.update(RichCallsDirection._key, value);
    }
}

export function register(disposables: vscode.Disposable[], memento: vscode.Memento) {

    const viewId = 'calls-view.tree';
    const history = new History();
    const provider = new DataProvider(history);
    const view = vscode.window.createTreeView(viewId, { treeDataProvider: provider });

    // highlight management
    const highlights = new EditorHighlights(view);
    vscode.window.onDidChangeActiveTextEditor(() => view.visible && highlights.refresh(), undefined, disposables);
    view.onDidChangeVisibility(e => e.visible ? highlights.show() : highlights.hide(), undefined, disposables);
    view.onDidChangeSelection(() => highlights.refresh(), undefined, disposables);

    const callsDirection = new RichCallsDirection(memento);

    const setModeCommand = (direction: CallsDirection) => {
        callsDirection.value = direction;
        if (provider.model) {
            updateModel(provider.model.changeDirection());
        } else {
            showCommand();
        }
    }

    const updateModel = async (model: CallsModel | undefined) => {

        vscode.commands.executeCommand('setContext', 'calls-view.hasResults', Boolean(model));
        provider.model = model;
        view.message = '';
        updateTitle();
        if (model) {
            const [first] = await model.root;
            view.reveal(first, { expand: true, focus: true });

            history.add(first, model);
        }
    }

    const updateTitle = () => {
        if (provider.model) {
            if (provider.model.direction === CallsDirection.Outgoing) {
                view.title = `Call Hierarchy - Calls`;
            } else {
                view.title = `Call Hierarchy - Callers`;
            }

        } else {
            view.title = 'Call Hierarchy'
        }
    }

    const showCommand = async (uri?: vscode.Uri, position?: vscode.Position) => {
        let model: CallsModel | undefined;
        if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
            model = new CallsModel(uri, position, callsDirection.value);
        } else if (vscode.window.activeTextEditor) {
            model = new CallsModel(vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.selection.anchor, callsDirection.value);
        }

        vscode.commands.executeCommand('setContext', 'calls-view.isActive', true);
        updateModel(model);
    }

    const clearCommand = () => {
        updateModel(undefined);
        highlights.hide();
        if (history.items.length === 0) {
            view.message = `To populate this view, open an editor and run the 'Show Call Hierarchy'-command.`;
        } else {
            view.message = `To populate this view, open an editor and run the 'Show Call Hierarchy'-command or run a previous search again:`;
        }
    };

    const makeRootCommand = (call: any) => {
        if (call instanceof Call) {
            return showCommand(call.item.uri, call.item.selectionRange.start);
        }
    }

    const openCallCommand = (arg: Call | HistoryItem, focusEditor: boolean = false) => {

        let uri: vscode.Uri | undefined;
        let pos: vscode.Position | undefined;

        if (arg instanceof Call) {
            uri = arg.item.uri;
            pos = arg.item.selectionRange.start;
        }
        if (arg instanceof HistoryItem) {
            uri = arg.uri;
            pos = arg.position;
        }

        if (uri && pos) {
            vscode.window.showTextDocument(uri, {
                selection: new vscode.Range(pos, pos),
                preserveFocus: !focusEditor
            });
        }
    }

    const showFromHistoryCommand = (item: HistoryItem) => {
        if (item instanceof HistoryItem) {
            showCommand(item.uri, item.position);
        }
    }

    disposables.push(
        view,
        vscode.commands.registerCommand('calls-view.show', showCommand),
        vscode.commands.registerCommand('calls-view.showOutgoing', () => setModeCommand(CallsDirection.Outgoing)),
        vscode.commands.registerCommand('calls-view.showIncoming', () => setModeCommand(CallsDirection.Incoming)),
        vscode.commands.registerCommand('calls-view.clear', clearCommand),
        vscode.commands.registerCommand('calls-view.makeRoot', makeRootCommand),
        vscode.commands.registerCommand('calls-view.reveal', openCallCommand),
        vscode.commands.registerCommand('calls-view.reshow', showFromHistoryCommand),
    );
}
