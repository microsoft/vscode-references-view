/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('API ', () => {

	test('stub', async function () {
		const apiObject = await vscode.extensions.getExtension('ms-vscode.references-view')?.activate();
		assert.strictEqual(apiObject, undefined);
	});

});
