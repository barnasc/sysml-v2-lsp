import { describe, expect, it } from 'vitest';

/**
 * `getWorkspaceSymbolIndexes` -- confirmed reported: three workspace-scoped providers each
 * independently rebuilding `buildSymbolIndexes` on their own per-document request (`sysml/model`,
 * `sysml/resolveReferences`) made a workspace-wide initial sync of many documents redundantly
 * repeat that full walk once per document, dominating a slow extension-host startup trace.
 */
describe('DocumentManager.getWorkspaceSymbolIndexes', () => {
    async function setup() {
        const { DocumentManager } = await import('../../server/src/documentManager.js');
        const { TextDocument } = await import('vscode-languageserver-textdocument');
        return { docManager: new DocumentManager(), TextDocument };
    }

    it('returns the same cached object across calls when nothing changed', async () => {
        const { docManager, TextDocument } = await setup();
        docManager.parse(TextDocument.create('file:///a.sysml', 'sysml', 1, 'package A { part def Vehicle; }'));

        const first = docManager.getWorkspaceSymbolIndexes();
        const second = docManager.getWorkspaceSymbolIndexes();

        expect(second).toBe(first);
    });

    it('rebuilds (and reflects the new content) once a parsed document actually changes', async () => {
        const { docManager, TextDocument } = await setup();
        docManager.parse(TextDocument.create('file:///a.sysml', 'sysml', 1, 'package A { part def Vehicle; }'));
        const first = docManager.getWorkspaceSymbolIndexes();
        expect(first.byQualifiedName.has('A::Wheel')).toBe(false);

        docManager.parse(TextDocument.create('file:///a.sysml', 'sysml', 2, 'package A { part def Vehicle; part def Wheel; }'));
        const second = docManager.getWorkspaceSymbolIndexes();

        expect(second).not.toBe(first);
        expect(second.byQualifiedName.has('A::Wheel')).toBe(true);
    });

    it('rebuilds once a second document is added to the workspace', async () => {
        const { docManager, TextDocument } = await setup();
        docManager.parse(TextDocument.create('file:///a.sysml', 'sysml', 1, 'package A { part def Vehicle; }'));
        const first = docManager.getWorkspaceSymbolIndexes();

        docManager.parse(TextDocument.create('file:///b.sysml', 'sysml', 1, 'package B { part def Wheel; }'));
        const second = docManager.getWorkspaceSymbolIndexes();

        expect(second).not.toBe(first);
        expect(second.byQualifiedName.has('B::Wheel')).toBe(true);
    });
});
