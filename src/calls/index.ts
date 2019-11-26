/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CallsDirection, CallsModel, Call } from './model';
import { DataProvider } from './provider';

export function register(disposables: vscode.Disposable[]) {

    const viewId = 'calls-view.tree';
    const provider = new DataProvider();

    const view = vscode.window.createTreeView(viewId, { treeDataProvider: provider });

    let callsDirection = CallsDirection.Outgoing;
    vscode.commands.executeCommand('setContext', 'calls-view.mode', 'showOutgoing');

    const setModeCommand = (direction: CallsDirection) => {
        if (callsDirection !== direction) {
            callsDirection = direction;
            vscode.commands.executeCommand('setContext', 'calls-view.mode', direction === CallsDirection.Incoming ? 'showIncoming' : 'showOutgoing');
            if (provider.model) {
                updateModel(provider.model.changeDirection());
            } else {
                showCommand();
            }
        }
    }

    const updateModel = async (model: CallsModel | undefined) => {

        vscode.commands.executeCommand('setContext', 'calls-view.hasResults', Boolean(model));
        view.message = '';
        provider.model = model;
        updateTitle();
        if (model) {
            const [first] = await model.root;
            view.reveal(first, { expand: true });
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
            model = new CallsModel(uri, position, callsDirection);
        } else if (vscode.window.activeTextEditor) {
            model = new CallsModel(vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.selection.anchor, callsDirection);
        }

        vscode.commands.executeCommand('setContext', 'calls-view.isActive', true);
        updateModel(model);
    }

    const makeRootCommand = (call: any) => {
        if (call instanceof Call) {
            return showCommand(call.item.uri, call.item.selectionRange.start);
        }
    }

    const clearCommand = () => {
        updateModel(undefined);
        view.message = `To populate this view, open an editor and run the 'Show Call Hierarchy'-command.`;
    };

    disposables.push(
        view,
        vscode.commands.registerCommand('calls-view.show', showCommand),
        vscode.commands.registerCommand('calls-view.show.outgoing', () => setModeCommand(CallsDirection.Outgoing)),
        vscode.commands.registerCommand('calls-view.show.incoming', () => setModeCommand(CallsDirection.Incoming)),
        vscode.commands.registerCommand('calls-view.clear', clearCommand),
        vscode.commands.registerCommand('calls-view.makeRoot', makeRootCommand),
    );
}
