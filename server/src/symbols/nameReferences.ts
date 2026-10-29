import { Location, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentManager } from '../documentManager.js';
import { SysMLv2Lexer } from '../generated/SysMLv2Lexer.js';
import { joinQualifiedName, scanFeaturePaths } from '../utils/identUtils.js';
import { buildSymbolIndexes, NameResolution, NamespaceResolver, ownerOf } from './namespaceResolver.js';
import { isAnonymous, SysMLSymbol } from './sysmlElements.js';

export interface NameReference extends Location {
    readonly name: string;
    readonly qualifiedName: string;
    readonly symbol?: SysMLSymbol;
    readonly isDeclaration: boolean;
    readonly isAmbiguous: boolean;
}

/** Source-token references shared by navigation and refactoring, resolved with SysML §7.5 visibility. */
export class NameReferences {
    private readonly symbols;
    private readonly indexes;
    private readonly resolver = new NamespaceResolver();

    constructor(private readonly documents: DocumentManager) {
        this.symbols = documents.getWorkspaceSymbolTable().getAllSymbols();
        this.indexes = buildSymbolIndexes(this.symbols);
    }

    at(uri: string, position: Position): NameReference | undefined {
        return this.inDocument(uri, position).find(ref =>
            ref.range.start.line === position.line &&
            ref.range.start.character <= position.character &&
            ref.range.end.character >= position.character);
    }

    to(symbol: SysMLSymbol, includeDeclaration = true): NameReference[] {
        return this.documents.getUris().flatMap(uri => this.inDocument(uri, undefined, symbol))
            .filter(ref => ref.symbol?.symbolId === symbol.symbolId &&
                (includeDeclaration || !ref.isDeclaration));
    }

    private inDocument(uri: string, position?: Position, target?: SysMLSymbol): NameReference[] {
        const text = this.documents.getText(uri);
        const parsed = this.documents.get(uri);
        if (text === undefined || !parsed) return [];
        const doc = TextDocument.create(uri, 'sysml', 0, text);
        const symbols = this.symbols.filter(symbol => symbol.uri === uri);
        const braces = parsed.tokenStream.getTokens()
            .filter(token => token.type === SysMLv2Lexer.LBRACE)
            .map(token => doc.offsetAt({ line: token.line - 1, character: token.column }));
        const namespaces = symbols.flatMap(symbol => {
            const start = doc.offsetAt(symbol.range.start);
            const end = doc.offsetAt(symbol.range.end);
            let lo = 0;
            let hi = braces.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (braces[mid] < start) lo = mid + 1;
                else hi = mid;
            }
            const body = braces[lo];
            return body === undefined || body >= end ? [] : [{ symbol, body, end }];
        }).sort((a, b) => (a.end - a.body) - (b.end - b.body));
        const refs: NameReference[] = [];
        const cursor = position ? doc.offsetAt(position) : undefined;
        for (const path of scanFeaturePaths(text)) {
            if (cursor !== undefined && (cursor < path.start || cursor > path.end)) continue;
            if (target && !path.qualifiedNames.some(name => name.segments.some(segment =>
                segment.name === target.name || segment.name === target.shortName))) continue;
            const namespace = namespaces.find(ns => ns.body < path.start && path.end <= ns.end);
            const redefiningOwner = this.redefiningOwner(symbols, doc, path.start, path.end);
            let receiver: SysMLSymbol | undefined;
            let receiverAmbiguous = false;
            for (let group = 0; group < path.qualifiedNames.length; group++) {
                const qualified = path.qualifiedNames[group];
                let resolved: SysMLSymbol | undefined;
                let ambiguous = false;
                for (let index = 0; index < qualified.segments.length; index++) {
                    const segment = qualified.segments[index];
                    const range = Range.create(doc.positionAt(segment.start), doc.positionAt(segment.end));
                    let before = segment.start - 1;
                    let after = segment.end;
                    while (before >= 0 && /\s/.test(text[before])) before--;
                    while (after < text.length && /\s/.test(text[after])) after++;
                    const declaration = symbols.find(symbol => !isAnonymous(symbol) && (
                        (symbol.selectionRange.start.line === range.start.line &&
                            symbol.selectionRange.start.character === range.start.character &&
                            symbol.selectionRange.end.character === range.end.character) ||
                        (symbol.shortName === segment.name && text[before] === '<' && text[after] === '>' &&
                            doc.offsetAt(symbol.range.start) <= segment.start &&
                            segment.end < doc.offsetAt(symbol.selectionRange.start))));
                    if (declaration) {
                        resolved = declaration;
                        ambiguous = false;
                    } else if (index > 0) {
                        if (resolved) {
                            const result = this.resolver.resolveMemberReference(resolved, segment.name, this.indexes);
                            resolved = result.symbol;
                            ambiguous = result.ambiguous;
                        }
                    } else if (group > 0) {
                        const result: NameResolution = receiver ? this.resolveFeature(receiver, segment.name)
                            : { ambiguous: receiverAmbiguous };
                        resolved = result.symbol;
                        ambiguous = result.ambiguous;
                    } else if (redefiningOwner) {
                        const result = this.resolver.resolveRedefinedFeature(redefiningOwner, joinQualifiedName([segment.name]), this.indexes);
                        resolved = result.symbol;
                        ambiguous = result.ambiguous;
                    } else {
                        const result = this.resolver.resolveReferenceIn(
                            namespace?.symbol, joinQualifiedName([segment.name]), this.indexes);
                        resolved = result.symbol;
                        ambiguous = result.ambiguous;
                    }
                    if (cursor !== undefined && (cursor < segment.start || cursor > segment.end)) continue;
                    if (target && segment.name !== target.name && segment.name !== target.shortName) continue;
                    refs.push({
                        uri, range, name: segment.name,
                        qualifiedName: index === qualified.segments.length - 1 ? qualified.name : segment.name,
                        symbol: resolved, isDeclaration: declaration !== undefined, isAmbiguous: ambiguous,
                    });
                }
                receiver = resolved;
                receiverAmbiguous = ambiguous;
            }
        }
        return refs;
    }

    /**
     * The type owning the feature whose redefinition target is the reference
     * from `start` to `end` -- which KerML 8.2.3.5.1 resolves from that type's
     * generals; else undefined.
     */
    private redefiningOwner(symbols: SysMLSymbol[], doc: TextDocument, start: number, end: number): SysMLSymbol | undefined {
        const redefining = symbols.find(symbol => symbol.redefinedFeatureTargetRanges?.some(range =>
            doc.offsetAt(range.start) <= start && end <= doc.offsetAt(range.end)));
        return redefining && ownerOf(redefining, this.indexes);
    }

    private resolveFeature(receiver: SysMLSymbol, name: string): NameResolution {
        const queue = [receiver];
        const visited = new Set<SysMLSymbol>();
        for (let index = 0; index < queue.length; index++) {
            const owner = queue[index];
            if (visited.has(owner)) continue;
            visited.add(owner);
            const member = this.resolver.resolveMemberReference(owner, name, this.indexes);
            if (member.symbol || member.ambiguous) return member;
            for (const typeName of owner.typeNames) {
                const type = this.resolver.resolveNameFrom(owner, typeName, this.indexes);
                if (type && !visited.has(type)) queue.push(type);
            }
        }
        return { ambiguous: false };
    }
}
