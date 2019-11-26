/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DataProvider } from './provider';
import { CallsModel, CallsDirection } from './model';

export function register(disposables: vscode.Disposable[]) {

    const viewId = 'calls-view.tree';
    const provider = new DataProvider();

    const view = vscode.window.createTreeView(viewId, {
        treeDataProvider: provider,
        showCollapseAll: true
    });


    let callsDirection = CallsDirection.Outgoing;
    vscode.commands.executeCommand('setContext', 'calls-view.mode', 'showOutgoing');

    const setDirectionToOutgoing = () => {
        if (callsDirection !== CallsDirection.Outgoing) {
            callsDirection = CallsDirection.Outgoing;
            vscode.commands.executeCommand('setContext', 'calls-view.mode', 'showOutgoing');
            refresh();
        }
    }

    const setDirectionToIncoming = () => {
        if (callsDirection !== CallsDirection.Incoming) {
            callsDirection = CallsDirection.Incoming;
            vscode.commands.executeCommand('setContext', 'calls-view.mode', 'showIncoming');
            refresh();
        }
    }

    const refresh = () => {
        const { model } = provider;
        if (model) {
            updateModel(model.changeDirection());
        } else {
            showCallHierarchy();
        }
    }

    const updateModel = async (model: CallsModel | undefined) => {

        vscode.commands.executeCommand('setContext', 'calls-view.hasResults', Boolean(model));

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
                view.title = `Calls From`;
            } else {
                view.title = `Callers Of`;
            }

        } else {
            view.title = 'Calls'
        }
    }

    const showCallHierarchy = async (uri?: vscode.Uri, position?: vscode.Position) => {
        let model: CallsModel | undefined;
        if (uri instanceof vscode.Uri && position instanceof vscode.Position) {
            model = new CallsModel(uri, position, callsDirection);
        } else if (vscode.window.activeTextEditor) {
            model = new CallsModel(vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.selection.anchor, callsDirection);
        }

        vscode.commands.executeCommand('setContext', 'calls-view.isActive', true);
        updateModel(model);
    }

    disposables.push(
        view,
        vscode.commands.registerCommand('calls-view.show', showCallHierarchy),
        vscode.commands.registerCommand('calls-view.show.outgoing', setDirectionToOutgoing),
        vscode.commands.registerCommand('calls-view.show.incoming', setDirectionToIncoming),
        vscode.commands.registerCommand('calls-view.clear', () => updateModel(undefined))
    );
}
