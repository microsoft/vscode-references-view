/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const enum CallsDirection {
    Incoming,
    Outgoing
}

export class Call {

    constructor(readonly item: vscode.CallHierarchyItem, readonly parent: Call | undefined, readonly locations: vscode.Location[] | undefined) { }
}

export class CallsModel {

    readonly root: Promise<Call[]>;

    constructor(readonly uri: vscode.Uri, readonly position: vscode.Position, readonly direction: CallsDirection) {
        this.root = Promise.resolve(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position)).then(items => {
            return items ? items.map(item => new Call(item, undefined, undefined)) : [];
        });
    }

    async resolveCalls(call: Call): Promise<Call[]> {
        if (this.direction === CallsDirection.Incoming) {
            const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', call.item);
            return calls ? calls.map(item => new Call(item.from, call, item.fromRanges.map(range => new vscode.Location(item.from.uri, range)))) : [];
        } else {
            const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', call.item);
            return calls ? calls.map(item => new Call(item.to, call, item.fromRanges.map(range => new vscode.Location(call.item.uri, range)))) : [];
        }
    }

    changeDirection(): CallsModel {
        return new CallsModel(this.uri, this.position, this.direction === CallsDirection.Incoming ? CallsDirection.Outgoing : CallsDirection.Incoming);
    }
}
