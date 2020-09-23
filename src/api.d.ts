/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface SymbolItemNavigation<T> {
	nearest(uri: vscode.Uri, position: vscode.Position): T | undefined;
	next(from: T): T;
	previous(from: T): T;
	location(item: T): vscode.Location | undefined;
}

export interface SymbolItemEditorHighlights<T> {
	getEditorHighlights(item: T, uri: vscode.Uri): vscode.Range[] | undefined;
}

export interface SymbolTreeModel {
	empty: boolean;
	message: string | undefined,
	provider: Required<vscode.TreeDataProvider<unknown>>;
	navigation?: SymbolItemNavigation<any>;
	highlights?: SymbolItemEditorHighlights<any>;
	dispose?(): void;
}

export interface SymbolTreeInput {
	readonly contextValue: string;
	readonly title: string;
	readonly uri: vscode.Uri;
	readonly position: vscode.Position;
	readonly hash: string;

	resolve(): Promise<SymbolTreeModel>;
	with(position: vscode.Position): SymbolTreeInput;
}
