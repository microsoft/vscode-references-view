/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface SymbolTree {

	/**
	 * Set the contents of the references viewlet. 
	 * 
	 * @param input A symbol tree input object
	 */
	setInput(input: SymbolTreeInput<unknown>): void;
}

/**
 * A symbol tree input is the entry point for populating the references viewlet.
 * Inputs must be anchored at a code location, they must have a title, and they 
 * must resolve to a model.
 */
export interface SymbolTreeInput<T> {

	/**
	 * The value of the `reference-list.source` context key. Use this to control
	 * input dependent commands.
	 */
	readonly contextValue: string;

	/**
	 * The (short) title of this input, like "Implementations" or "Callers Of"
	 */
	readonly title: string;

	/**
	 * The location at which this position is anchored. Locations are validated and inputs
	 * with "funny" locations might be ignored
	 */
	readonly location: vscode.Location;

	/**
	 * Resolve this input to a model that contains the actual data.
	 */
	resolve(): Promise<SymbolTreeModel<T>>;

	/**
	 * This function is called when re-running from history. The symbols tree has tracked
	 * the original location of this input and that is now passed to this input. The 
	 * implementation of this function should return a clone where the `location`-property
	 * uses the passed `position`.
	 * 
	 * @param position The position at which the new input should be anchored.
	 * @returns A new input which location is anchored at the position.
	 */
	with(position: vscode.Position): SymbolTreeInput<T>;
}

/**
 * A symbol tree model which is used to populate the symbols tree.
 */
export interface SymbolTreeModel<T> {

	/**
	 * Signal that there are no results. This is only read after receiving
	 * the input and used to for a message like "No results, try a previous search..."
	 */
	readonly empty: boolean;

	/**
	 * A tree data provider which is used to populate the symbols tree.
	 */
	provider: vscode.TreeDataProvider<T>;

	/**
	 * An optional message that is displayed above the tree. Whenever the provider
	 * fires a change event this message is read again.
	 */
	message: string | undefined;

	/**
	 * Optional support for symbol navigation. When implemented, navigation commands like
	 * "Go to Next" and "Go to Previous" will be working with this model.
	 */
	navigation?: SymbolItemNavigation<T>;

	/**
	 * Optional support for editor highlights. WHen implemented, the editor will highlight 
	 * symbol ranges in the source code.
	 */
	highlights?: SymbolItemEditorHighlights<T>;

	/**
	 * Optional dispose function which is invoked when this model is
	 * needed anymore
	 */
	dispose?(): void;
}

/**
 * Interface to support the built-in symbol navigation.
 */
export interface SymbolItemNavigation<T> {
	/**
	 * Return the item that is the nearest to the given location or `undefined`
	 */
	nearest(uri: vscode.Uri, position: vscode.Position): T | undefined;
	/**
	 * Return the next item from the given item or the item itself.
	 */
	next(from: T): T;
	/**
	 * Return the previous item from the given item or the item itself.
	 */
	previous(from: T): T;
	/**
	 * Return the location of the given item.
	 */
	location(item: T): vscode.Location | undefined;
}

/**
 * Interface to support the built-in editor highlights.
 */
export interface SymbolItemEditorHighlights<T> {
	/**
	 * Given an item and an uri return an array of ranges to highlight.
	 */
	getEditorHighlights(item: T, uri: vscode.Uri): vscode.Range[] | undefined;
}
