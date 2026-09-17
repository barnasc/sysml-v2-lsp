import { describe, expect, it } from 'vitest';

/**
 * Tests for the `sysml/resolveReferences` custom LSP request. Exercises
 * `ResolveReferencesProvider` directly (without a running LSP connection),
 * mirroring `sysmlModel.test.ts`'s approach for `sysml/model`.
 */
describe('ResolveReferencesProvider', () => {
    async function resolveForDocuments(
        entries: Array<{ uri: string; text: string }>,
        references: Array<{ scopeQualifiedName: string; name: string }>,
    ) {
        const { DocumentManager } = await import('../../server/src/documentManager.js');
        const { ResolveReferencesProvider } = await import('../../server/src/model/resolveReferencesProvider.js');
        const { TextDocument } = await import('vscode-languageserver-textdocument');

        const docManager = new DocumentManager();
        for (const entry of entries) {
            docManager.parse(TextDocument.create(entry.uri, 'sysml', 1, entry.text));
        }

        const provider = new ResolveReferencesProvider(docManager);
        return provider.resolveReferences({ references });
    }

    it('should resolve a same-document, same-package reference', async () => {
        const text = `
package Test {
    part def Vehicle;
    part v : Vehicle;
}
`;
        const result = await resolveForDocuments(
            [{ uri: 'file:///test.sysml', text }],
            [{ scopeQualifiedName: 'Test', name: 'Vehicle' }],
        );
        expect(result.resolutions).toEqual([{ targetQualifiedName: 'Test::Vehicle' }]);
    });

    it('should resolve a cross-document reference reachable via import', async () => {
        const pkgAText = `
package PkgA {
    part def Part3;
}
`;
        const pkgBText = `
package PkgB {
    import PkgA::Part3;
    part usesPart3 : Part3;
}
`;
        const result = await resolveForDocuments(
            [{ uri: 'file:///pkg-a.sysml', text: pkgAText }, { uri: 'file:///pkg-b.sysml', text: pkgBText }],
            [{ scopeQualifiedName: 'PkgB', name: 'Part3' }],
        );
        expect(result.resolutions).toEqual([{ targetQualifiedName: 'PkgA::Part3' }]);
    });

    it('should NOT resolve a cross-document reference with no import connecting them', async () => {
        const pkgAText = `
package PkgA {
    part def Part3;
}
`;
        const pkgBText = `
package PkgB {
    part usesPart3 : Part3;
}
`;
        const result = await resolveForDocuments(
            [{ uri: 'file:///pkg-a.sysml', text: pkgAText }, { uri: 'file:///pkg-b.sysml', text: pkgBText }],
            [{ scopeQualifiedName: 'PkgB', name: 'Part3' }],
        );
        expect(result.resolutions).toEqual([{ targetQualifiedName: null }]);
    });

    it('should return null for an unknown scope', async () => {
        const result = await resolveForDocuments(
            [{ uri: 'file:///test.sysml', text: 'package Test { part def Vehicle; }' }],
            [{ scopeQualifiedName: 'NoSuchPackage', name: 'Vehicle' }],
        );
        expect(result.resolutions).toEqual([{ targetQualifiedName: null }]);
    });

    it('should resolve a batch of references in request order', async () => {
        const text = `
package Test {
    part def A;
    part def B;
    part a : A;
    part b : B;
}
`;
        const result = await resolveForDocuments(
            [{ uri: 'file:///test.sysml', text }],
            [
                { scopeQualifiedName: 'Test', name: 'B' },
                { scopeQualifiedName: 'Test', name: 'A' },
                { scopeQualifiedName: 'Test', name: 'NoSuchType' },
            ],
        );
        expect(result.resolutions).toEqual([
            { targetQualifiedName: 'Test::B' },
            { targetQualifiedName: 'Test::A' },
            { targetQualifiedName: null },
        ]);
    });
});
