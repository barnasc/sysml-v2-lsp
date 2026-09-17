/**
 * DTO types for the `sysml/resolveReferences` custom LSP request.
 *
 * Batch-resolves a list of (scope, name) reference lookups against the
 * workspace symbol table, using the same namespace/import-aware resolution
 * (`NamespaceResolver`) the `unresolved-type` diagnostic uses. Intended for
 * clients that need to resolve a reference to its real qualified name,
 * -- including one only reachable through an `import`, or defined in another document --
 * without reimplementing §7.5 namespace/import resolution themselves.
 */

/** One reference to resolve: `name` as written at the site owned by `scopeQualifiedName`. */
export interface ReferenceToResolve {
    /** Qualified name of the namespace the reference is written in (its innermost enclosing scope). */
    scopeQualifiedName: string;
    /** The reference text as written (simple or qualified, e.g. "Part3" or "Pkg::Part3"). */
    name: string;
}

export interface SysMLResolveReferencesParams {
    references: ReferenceToResolve[];
}

/** Resolution result for one `ReferenceToResolve`, in the same order as the request. */
export interface ResolvedReference {
    /** The resolved element's qualified name, or `null` if it couldn't be resolved at all. */
    targetQualifiedName: string | null;
}

export interface SysMLResolveReferencesResult {
    resolutions: ResolvedReference[];
}
