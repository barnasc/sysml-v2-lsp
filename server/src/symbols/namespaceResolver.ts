/**
 * Namespace/import/visibility mechanics (SysML v2 §7.5): given a namespace,
 * what members does it actually have -- its own, plus whatever its `import`
 * statements bring in. This is the pure §7.5 model; standard-library/ISQ
 * type recognition builds on top of it in `typeResolution.ts`.
 *
 * Shared between `SemanticValidator` (editor diagnostics) and
 * `SysMLModelProvider` (the `sysml/model` request's own diagnostics) so both
 * agree on what "resolved" means -- extracted here specifically so neither
 * has to import the other (they already depend on each other for unrelated
 * features, and importing a full sibling class both ways would recurse at
 * construction time).
 */

import { FilterExpr, ImportTarget, SysMLElementKind, SysMLSymbol, isDefinition } from './sysmlElements.js';

export interface SymbolIndexes {
    byName: Map<string, SysMLSymbol[]>;
    byParent: Map<string, SysMLSymbol[]>;
    byQualifiedName: Map<string, SysMLSymbol>;
    definitionsByName: Map<string, SysMLSymbol[]>;
    portsByName: Map<string, SysMLSymbol[]>;
}

/** One entry in a namespace's resolved member table (see `NamespaceResolver.getResolvedMembers`). */
export interface ResolvedMember {
    symbol: SysMLSymbol;
    /** Effective visibility of this membership *within its resolving namespace*. */
    visibility: 'public' | 'private' | 'protected';
}

/** Build the byName/byParent/byQualifiedName/etc. indexes a `NamespaceResolver` (and other checks) need from a flat symbol array. */
export function buildSymbolIndexes(allSymbols: SysMLSymbol[]): SymbolIndexes {
    const byName = new Map<string, SysMLSymbol[]>();
    const byParent = new Map<string, SysMLSymbol[]>();
    const byQualifiedName = new Map<string, SysMLSymbol>();
    const definitionsByName = new Map<string, SysMLSymbol[]>();
    const portsByName = new Map<string, SysMLSymbol[]>();

    for (const s of allSymbols) {
        const nameList = byName.get(s.name) ?? [];
        nameList.push(s);
        byName.set(s.name, nameList);

        byQualifiedName.set(s.qualifiedName, s);

        // Root-level symbols (no parentQualifiedName) are keyed under '', the
        // implicit root namespace -- mirrors the '' sentinel used for namespace
        // ancestor chains, so byParent.get('') gives the root's own members.
        const parentKey = s.parentQualifiedName ?? '';
        const children = byParent.get(parentKey) ?? [];
        children.push(s);
        byParent.set(parentKey, children);

        if (isDefinition(s.kind)) {
            const defs = definitionsByName.get(s.name) ?? [];
            defs.push(s);
            definitionsByName.set(s.name, defs);
        }

        if (s.kind === SysMLElementKind.PortUsage || s.kind === SysMLElementKind.PortDef) {
            const ports = portsByName.get(s.name) ?? [];
            ports.push(s);
            portsByName.set(s.name, ports);
        }
    }

    return { byName, byParent, byQualifiedName, definitionsByName, portsByName };
}

/** AND together zero or more (possibly undefined) filter expressions; `undefined` means "no filter". */
function combineFilters(exprs: Array<FilterExpr | undefined> | undefined): FilterExpr | undefined {
    const defined = (exprs ?? []).filter((e): e is FilterExpr => e !== undefined);
    if (defined.length === 0) return undefined;
    return defined.reduce((left, right) => ({ kind: 'and', left, right }));
}

/**
 * Evaluate a §7.5.4 filter condition against a candidate member. Only the
 * metadata classification-test subset is modeled (see FilterExpr's doc
 * comment); 'unsupported' evaluates to true (fail-open), so a filter
 * expression this doesn't understand never silently blocks an otherwise
 * valid import.
 */
export function evaluateFilter(expr: FilterExpr, symbol: SysMLSymbol): boolean {
    switch (expr.kind) {
        case 'metadata':
            return (symbol.metadataAnnotations ?? []).some(name => {
                const simpleName = name.includes('::') ? name.split('::').pop()! : name;
                return name === expr.name || simpleName === expr.name;
            });
        case 'and':
            return evaluateFilter(expr.left, symbol) && evaluateFilter(expr.right, symbol);
        case 'or':
            return evaluateFilter(expr.left, symbol) || evaluateFilter(expr.right, symbol);
        case 'not':
            return !evaluateFilter(expr.expr, symbol);
        case 'unsupported':
            return true;
    }
}

/**
 * Resolves whether a name is visible from a given reference site, per
 * SysML v2 §7.5's namespace/import/visibility model. Owns a cache of each
 * namespace's resolved member table, keyed by `SymbolIndexes` identity, so
 * multiple resolutions against the same workspace snapshot are cheap.
 */
export class NamespaceResolver {
    private resolvedMembersByIndexes?: WeakMap<SymbolIndexes, Map<string, Map<string, ResolvedMember[]>>>;

    /**
     * Whether `name` (simple or qualified, e.g. `"Owner::Nested::Target"`) is
     * resolvable from `symbol`'s reference site, per §7.5.1: "A qualified name
     * with more than one segment is resolved by recursively resolving the
     * name of the qualifying namespace and then resolving the element name in
     * that context." A qualified name is *not* just "is the first segment
     * visible" (a package name being resolvable doesn't mean every name after
     * `::` is one of its actual members) -- each segment after the first must
     * be a genuine member (owned or imported) of the previously-resolved
     * namespace.
     */
    isLocallyVisible(symbol: SysMLSymbol, name: string, indexes: SymbolIndexes): boolean {
        const [first, ...rest] = name.split('::');

        let resolvedQualifiedName: string | undefined;
        for (const ancestorQualifiedName of this.namespaceAncestors(symbol, indexes)) {
            const candidates = this.getResolvedMembers(ancestorQualifiedName, indexes).get(first);
            if (candidates && candidates.length > 0) {
                resolvedQualifiedName = candidates[0].symbol.qualifiedName;
                break;
            }
        }
        if (resolvedQualifiedName === undefined) return false;

        for (const segment of rest) {
            const members = this.getResolvedMembers(resolvedQualifiedName, indexes).get(segment);
            if (!members || members.length === 0) return false;
            resolvedQualifiedName = members[0].symbol.qualifiedName;
        }
        return true;
    }

    /**
     * Qualified names of `symbol`'s enclosing namespaces (its parent, its
     * parent's parent, ...), plus the implicit root namespace (`''`).
     * Members of any of these are visible from `symbol` without an import.
     */
    namespaceAncestors(symbol: SysMLSymbol, indexes: SymbolIndexes): Set<string> {
        const ancestors = new Set<string>(['']);
        let current = symbol.parentQualifiedName;
        let guard = 0;
        while (current && guard++ < 64) {
            ancestors.add(current);
            current = indexes.byQualifiedName.get(current)?.parentQualifiedName;
        }
        return ancestors;
    }

    /**
     * The resolved member table of namespace `qualifiedName` (`''` for the
     * implicit root): its own owned members, plus everything brought in by
     * its `import` statements — including, transitively, a further namespace's
     * own already-imported (and non-privately-imported) members, matching
     * §7.5.3's "imported memberships become members of the importing
     * namespace" and its P2/Q re-import example. Cached per `indexes`.
     */
    getResolvedMembers(qualifiedName: string, indexes: SymbolIndexes): Map<string, ResolvedMember[]> {
        if (!this.resolvedMembersByIndexes) this.resolvedMembersByIndexes = new WeakMap();
        let perIndexesCache = this.resolvedMembersByIndexes.get(indexes);
        if (!perIndexesCache) {
            perIndexesCache = new Map();
            this.resolvedMembersByIndexes.set(indexes, perIndexesCache);
        }
        const cached = perIndexesCache.get(qualifiedName);
        if (cached) return cached;

        // Cycle guard: seed with an empty table before recursing, so an import
        // cycle sees "nothing yet" for the in-progress namespace instead of
        // recursing forever. The real (non-empty) result overwrites it below.
        perIndexesCache.set(qualifiedName, new Map());

        const members = new Map<string, ResolvedMember[]>();
        const addMember = (name: string, entry: ResolvedMember) => {
            const list = members.get(name) ?? [];
            if (!list.some(e => e.symbol === entry.symbol)) list.push(entry);
            members.set(name, list);
        };

        for (const owned of indexes.byParent.get(qualifiedName) ?? []) {
            addMember(owned.name, { symbol: owned, visibility: owned.visibility ?? 'public' });
        }

        const owner = indexes.byQualifiedName.get(qualifiedName);
        const importTargets = owner?.importTargets ?? [];
        // §7.5.4: a package-level `filter` applies to every import of that package,
        // combined (AND) with any filter on the specific import itself.
        const packageFilter = combineFilters(owner?.filterConditions);
        for (const imp of importTargets) {
            const effectiveFilter = combineFilters([packageFilter, imp.filter].filter((f): f is FilterExpr => f !== undefined));
            const filteredAddMember = effectiveFilter
                ? (name: string, entry: ResolvedMember) => {
                    if (evaluateFilter(effectiveFilter, entry.symbol)) addMember(name, entry);
                }
                : addMember;
            this.applyImport(imp, indexes, filteredAddMember);
        }

        perIndexesCache.set(qualifiedName, members);
        return members;
    }

    /**
     * Fold one `import` statement's contribution into `addMember`, per the
     * membership vs. namespace / shallow vs. `::**` deep distinctions in
     * ImportTarget (§7.5.3, including the P4/P5/P6 recursive-import example).
     */
    private applyImport(
        imp: ImportTarget,
        indexes: SymbolIndexes,
        addMember: (name: string, entry: ResolvedMember) => void,
    ): void {
        switch (imp.kind) {
            case 'membership': {
                const target = indexes.byQualifiedName.get(imp.target);
                if (target) addMember(target.name, { symbol: target, visibility: imp.visibility });
                break;
            }
            case 'membership-deep': {
                const target = indexes.byQualifiedName.get(imp.target);
                if (target) {
                    addMember(target.name, { symbol: target, visibility: imp.visibility });
                    this.importVisibleMembers(imp.target, imp.visibility, indexes, addMember, true);
                }
                break;
            }
            case 'namespace-shallow':
                this.importVisibleMembers(imp.target, imp.visibility, indexes, addMember, false);
                break;
            case 'namespace-deep':
                this.importVisibleMembers(imp.target, imp.visibility, indexes, addMember, true);
                break;
        }
    }

    /**
     * Import the non-private/protected resolved members of `ownerQualifiedName`
     * (its own members plus, transitively, its own public imports), tagging
     * each with `importVisibility` (this import statement's own keyword, which
     * governs re-export — not the source member's original visibility). When
     * `recursive`, also recurse into any imported member that is itself a
     * namespace (owns members), per the `::**` "continues into namespaces
     * that are owned members of an imported namespace" rule.
     */
    private importVisibleMembers(
        ownerQualifiedName: string,
        importVisibility: 'public' | 'private' | 'protected',
        indexes: SymbolIndexes,
        addMember: (name: string, entry: ResolvedMember) => void,
        recursive: boolean,
    ): void {
        for (const [name, entries] of this.getResolvedMembers(ownerQualifiedName, indexes)) {
            for (const entry of entries) {
                if (entry.visibility === 'private' || entry.visibility === 'protected') continue;
                addMember(name, { symbol: entry.symbol, visibility: importVisibility });
                if (recursive) {
                    this.importVisibleMembers(entry.symbol.qualifiedName, importVisibility, indexes, addMember, true);
                }
            }
        }
    }
}
