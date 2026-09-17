/**
 * Provider for the `sysml/resolveReferences` custom LSP request — see
 * `resolveReferencesTypes.ts` for the protocol shapes and rationale.
 */

import { DocumentManager } from '../documentManager.js';
import { NamespaceResolver, buildSymbolIndexes } from '../symbols/namespaceResolver.js';
import type { SysMLResolveReferencesParams, SysMLResolveReferencesResult } from './resolveReferencesTypes.js';

export class ResolveReferencesProvider {
    private readonly namespaceResolver = new NamespaceResolver();

    constructor(private readonly documentManager: DocumentManager) { }

    /**
     * Resolves each `{ scopeQualifiedName, name }` pair against the current
     * workspace symbol table, in request order. `scopeQualifiedName` is the
     * namespace the reference is written *within* (e.g. a package), resolved
     * via `NamespaceResolver.resolveFrom` -- not a reference-site symbol
     * whose *parent* is that namespace, which is what `resolve` expects. A
     * `scopeQualifiedName` that doesn't match any known namespace, or a
     * `name` that doesn't resolve from it, yields `targetQualifiedName: null`
     * for that entry rather than failing the whole batch.
     */
    resolveReferences(params: SysMLResolveReferencesParams): SysMLResolveReferencesResult {
        const indexes = buildSymbolIndexes(this.documentManager.getWorkspaceSymbolTable().getAllSymbols());
        const resolutions = (params?.references ?? []).map(ref => {
            const target = this.namespaceResolver.resolveFrom(ref.scopeQualifiedName, ref.name, indexes);
            return { targetQualifiedName: target?.qualifiedName ?? null };
        });
        return { resolutions };
    }
}
