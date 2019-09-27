import { createModel, Model, FolderItem, FileItem, ReferenceItem, ItemKind, ModelConfiguration } from '../model';
import * as vscode from 'vscode';
import * as assert from 'assert';

const pos = new vscode.Position(0, 0);

interface NodeDesc {
    kind: ItemKind;
    name?: string;
    children?: NodeDesc[];
}

function toNodeDesc(item: FolderItem | FileItem | ReferenceItem): NodeDesc {
    if (item.kind === 'reference') {
        return {
            kind: item.kind,
        }
    } else if (item.kind === 'file') {
        return {
            kind: item.kind,
            name: item.name,
            children: item.references.map((it) => toNodeDesc(it))
        }
    } else if (item.kind === 'folder') {
        const folders = item.folders.map((it) => toNodeDesc(it));
        const files = item.files.map((it) => toNodeDesc(it));
        return {
            kind: item.kind,
            name: item.name,
            children: [...folders, ...files]
        }
    } else {
        throw new Error('No item.kind. This is impossible');
    }
}

function describeModel(model: Model): NodeDesc[] {
    const rootDesc = toNodeDesc(model.root);
    return rootDesc.children!;
}

function newLoc(path: string): vscode.Location {
    return new vscode.Location(vscode.Uri.file(path), pos);
}

function assertModel(structure: NodeDesc[], model: Model) {
    const modelDesc = describeModel(model);
    assert.deepStrictEqual(modelDesc, structure);
}

suite('Model Test', () => {
    suite('Flat Model', () => {
        const config = {
            rootUris: [vscode.Uri.file('/root')],
            showFolders: false
        };

        let model: Model;

        setup(() => {
            model = createModel(vscode.Uri.file('/root/a'), pos, [
                newLoc('/root/b'),
                newLoc('/root/b')
            ], config);
        })

        test('Simple Structure', () => {
            assertModel([{
                kind: 'file',
                name: 'b',
                children: [
                    { kind: 'reference' },
                    { kind: 'reference' }
                ]
            }], model);
        });

        test('Remove file works', () => {
            model.remove(model.root.files[0]);
            
            assertModel([], model);
        });

        test('Remove one ref works', () => {
            model.remove(model.root.files[0].references[0]);
            
            assertModel([{
                kind: 'file',
                name: 'b',
                children: [
                    { kind: 'reference' },
                ]
            }], model);
        });

        test('Remove all refs in a file works', () => {
            model.remove(model.root.files[0].references[1]);
            model.remove(model.root.files[0].references[0]);

            assertModel([], model);
        });
    });

    suite('Hierarchical Model', () => {
        const config = {
            rootUris: [vscode.Uri.file('/root')],
            showFolders: true
        };

        test('Collapse on construction', () => {
            const model = createModel(vscode.Uri.file('/root/a'), pos, [
                newLoc('/root/b/c/d'),
                newLoc('/root/b/c/e'),
            ], config);

            assertModel(
                [{
                    kind: 'folder',
                    name: 'b/c',
                    children: [
                        { kind: 'file', name: 'd', children: [ { kind: 'reference'} ]},
                        { kind: 'file', name: 'e', children: [ { kind: 'reference'} ]}                        
                    ]
                }],
                model
            );
        });

        suite('Simple Deletion', () => {
            let model: Model;

            setup(() => {
                model = createModel(vscode.Uri.file('/root/a'), pos, [
                    newLoc('/root/b/c/d'),
                    newLoc('/root/b/c/e'),
                ], config);
            });

            test('Delete ref', () => {
                model.remove(model.root.folders[0].files[0].references[0])
    
                assertModel(
                    [{
                        kind: 'folder',
                        name: 'b/c',
                        children: [
                            { kind: 'file', name: 'e', children: [ { kind: 'reference'} ]}                        
                        ]
                    }],
                    model
                );
            });

            test('Delete file', () => {
                model.remove(model.root.folders[0].files[0]);

                assertModel(
                    [{
                        kind: 'folder',
                        name: 'b/c',
                        children: [
                            { kind: 'file', name: 'e', children: [ { kind: 'reference'} ]}                        
                        ]
                    }],
                    model
                );
            });

            test('Delete folder', () => {
                model.remove(model.root.folders[0]);

                assertModel([], model);
            });
        });

        test('Collapsing deletion', () => {
            const model = createModel(vscode.Uri.file('/root/a'), pos, [
                newLoc('/root/b/c/d/e/f/g'),
                newLoc('/root/b/c/x'),
            ], config);

            model.remove(model.root.folders[0].files[0]);

            assertModel(
                [{
                    kind: 'folder',
                    name: 'b/c/d/e/f',
                    children: [
                        { kind: 'file', name: 'g', children: [ { kind: 'reference'} ]}                        
                    ]
                }],
                model
            );
        });
    });
});