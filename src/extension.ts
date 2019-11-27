/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as references from './refs';
import * as calls from './calls';

export function activate(context: vscode.ExtensionContext) {
    references.register(context.subscriptions);
    calls.register(context.subscriptions, context.globalState);
}
