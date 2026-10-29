import {
    DocumentSymbol,
    DocumentSymbolParams,
} from 'vscode-languageserver/node';
import { DocumentManager } from '../documentManager.js';
import { SysMLSymbol, displayName, toMetaclassName } from '../symbols/sysmlElements.js';
import { toSysMLSymbolKind } from './symbolKindMapping.js';

/**
 * Provides document symbols for the outline panel and breadcrumbs.
 * Walks the symbol table and builds a hierarchical DocumentSymbol tree.
 */
export class DocumentSymbolProvider {

    constructor(private documentManager: DocumentManager) { }

    provideDocumentSymbols(params: DocumentSymbolParams): DocumentSymbol[] {
        // The workspace symbol table's: a usage named after a feature in another
        // document is named after it, and named again when that document changes.
        const symbols = this.documentManager.getWorkspaceSymbolTable().getSymbolsForUri(params.textDocument.uri);

        // Build hierarchical structure
        return this.buildHierarchy(symbols);
    }

    private buildHierarchy(symbols: SysMLSymbol[]): DocumentSymbol[] {
        // Separate top-level symbols from children, linked by their owner's symbol ID
        const topLevel: SysMLSymbol[] = [];
        const ids = new Set(symbols.map(sym => sym.symbolId));
        const childrenOf = new Map<string, SysMLSymbol[]>();

        for (const sym of symbols) {
            if (!sym.parentId || !ids.has(sym.parentId)) {
                topLevel.push(sym);
            } else {
                const siblings = childrenOf.get(sym.parentId) ?? [];
                siblings.push(sym);
                childrenOf.set(sym.parentId, siblings);
            }
        }

        const buildSymbol = (sym: SysMLSymbol): DocumentSymbol => {
            const children = childrenOf.get(sym.symbolId) ?? [];
            return {
                name: displayName(sym),
                detail: toMetaclassName(sym.kind),
                kind: toSysMLSymbolKind(sym.kind),
                range: sym.range,
                selectionRange: sym.selectionRange,
                children: children.map(buildSymbol),
            };
        };

        return topLevel.map(buildSymbol);
    }
}
