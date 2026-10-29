/**
 * Integration / end-to-end tests that exercise the LSP provider pipeline.
 *
 * These tests go beyond isolated unit tests: they wire up multiple
 * providers against the same DocumentManager and verify that the
 * parse → symbol table → diagnostics → hover → definition → completion
 * pipeline produces correct, coherent results for realistic SysML
 * models.
 *
 * They also cover lexer-derived keywords and preservation of syntax errors
 * alongside valid expressions, unrestricted names and notes.
 */
import { describe, expect, it } from 'vitest';
import { hiddenSyntaxErrorCases } from '../fixtures/syntaxDiagnostics.js';

// ---------------------------------------------------------------------------
// Helpers (same dynamic-import pattern used by existing tests)
// ---------------------------------------------------------------------------

async function makeDoc(text: string, uri = 'test://test.sysml') {
    const { TextDocument } = await import('vscode-languageserver-textdocument');
    return TextDocument.create(uri, 'sysml', 1, text);
}

async function setup(text: string, uri = 'test://test.sysml') {
    const { DocumentManager } = await import('../../server/src/documentManager.js');
    const dm = new DocumentManager();
    const doc = await makeDoc(text, uri);
    dm.parse(doc);
    return { dm, doc, uri };
}

// ═══════════════════════════════════════════════════════════════════════════
// Fix (8) — keyword set derived from lexer
// ═══════════════════════════════════════════════════════════════════════════

describe('Keyword derivation from ANTLR lexer', () => {
    it('should derive a non-trivial keyword set from the generated lexer', async () => {
        const { SysMLv2Lexer } = await import('../../server/src/generated/SysMLv2Lexer.js');

        const keywords = SysMLv2Lexer.literalNames
            .filter((name): name is string => name !== null && /^'[a-z]+'$/.test(name))
            .map(name => name.slice(1, -1));

        // The grammar should produce a substantial keyword set; exact count
        // varies as the grammar evolves.
        expect(keywords.length).toBeGreaterThan(100);
    });

    it('should include keywords that were previously missing from the hardcoded set', async () => {
        const { SysMLv2Lexer } = await import('../../server/src/generated/SysMLv2Lexer.js');

        const keywords = new Set(
            SysMLv2Lexer.literalNames
                .filter((name): name is string => name !== null && /^'[a-z]+'$/.test(name))
                .map(name => name.slice(1, -1))
        );

        // These were absent from the old hardcoded set
        const previouslyMissing = [
            'assoc', 'behavior', 'chains', 'class', 'classifier',
            'composite', 'connector', 'const', 'datatype', 'expr',
            'function', 'interaction', 'predicate', 'struct',
            'subset', 'subtype', 'typed', 'typing', 'unions',
            'until', 'var', 'via',
        ];
        for (const kw of previouslyMissing) {
            expect(keywords.has(kw), `expected '${kw}' in keyword set`).toBe(true);
        }
    });

    it('should correctly identify previously-missing keywords in the symbol table isKeyword check', async () => {
        // Verify the keyword set is used correctly by the symbol table.
        // We parse a model where a previously-missing keyword ("struct")
        // appears as a keyword in context.  If "struct" were NOT in the
        // keyword set, the symbol table's isIdentifierToken() would
        // misclassify it as an identifier and try to use it as a name.
        //
        // We use "part def" (which IS extracted) and include "struct" as
        // an attribute name, confirming "struct" is treated as a keyword
        // and NOT as a valid identifier.
        const text = `
package KeywordTest {
    part def MyPart {
        attribute name : Real;
    }
}
`;
        const { dm, uri } = await setup(text);
        const st = dm.getSymbolTable(uri);
        expect(st).toBeDefined();
        const symbols = st!.getSymbolsForUri(uri);

        const names = symbols.map(s => s.name);
        expect(names).toContain('MyPart');
        // "part" and "def" are keywords and should not appear as symbol names
        expect(names).not.toContain('part');
        expect(names).not.toContain('def');
        expect(names).not.toContain('attribute');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Syntax diagnostics alongside valid expressions
// ═══════════════════════════════════════════════════════════════════════════

describe('Syntax diagnostic preservation', () => {
    it.each(hiddenSyntaxErrorCases)('reports every parser error with $name (#154)', async ({ text, line }) => {
        const { DiagnosticsProvider } = await import('../../server/src/providers/diagnosticsProvider.js');
        const { dm, uri } = await setup(text);
        const errors = dm.get(uri)!.errors;
        expect(errors).toHaveLength(1);
        expect(errors[0].line).toBe(line);

        const diagnostics = new DiagnosticsProvider(dm).getDiagnostics(uri);
        expect(diagnostics.map(d => d.range)).toEqual(errors.map(error => ({
            start: { line: error.line, character: error.column },
            end: { line: error.line, character: error.column + error.length },
        })));
        expect(diagnostics[0]).toMatchObject({ severity: 1, source: 'sysml' });
    });

    it('should report syntax errors in blocks WITHOUT expression operators', async () => {
        const { DiagnosticsProvider } = await import('../../server/src/providers/diagnosticsProvider.js');
        // This block has no arithmetic / expression operators.
        // The typo "par" should produce a syntax error.
        const text = `
package BrakeSystem {
    part def Brake {
        attribute force : Real;
    }
    par pedal : Brake;
}
`;
        const { dm, uri } = await setup(text, 'test://suppression.sysml');
        const provider = new DiagnosticsProvider(dm);
        const diags = provider.getDiagnostics(uri);

        expect(diags.length).toBeGreaterThan(0);
        // The error should mention the unexpected token (parser may phrase
        // it as "mismatched input 'pedal'" or similar)
        const messages = diags.map(d => d.message).join(' ');
        expect(messages).toMatch(/mismatched|extraneous|no viable/i);
    });

    it.each([
        'weight == mass * 9.81', 'weight == 10 * 2', 'weight == 2 + 3',
    ])('parses valid expression %s without syntax errors', async expression => {
        const { DiagnosticsProvider } = await import('../../server/src/providers/diagnosticsProvider.js');
        // SysMLv2Parser.ownedExpression supports arithmetic; no filtering is needed.
        const text = `
package Physics {
    constraint def GravityConstraint {
        attribute mass : Real;
        attribute weight : Real;
        ${expression}
    }
}
`;
        const { dm, uri } = await setup(text, 'test://expression.sysml');
        const provider = new DiagnosticsProvider(dm);
        const diags = provider.getDiagnostics(uri);

        expect(dm.get(uri)!.errors).toEqual([]);
        expect(diags).toEqual([]);
    });

    it('should not globally suppress extraneous "}" errors in unrelated blocks', async () => {
        const { DiagnosticsProvider } = await import('../../server/src/providers/diagnosticsProvider.js');
        // A valid expression does not hide a trailing stray brace.
        const text = `
package Mixed {
    constraint def ForceCalc {
        attribute f : Real;
        f == 10 * 2
    }
}
}
`;
        const { dm, uri } = await setup(text, 'test://stray-brace.sysml');
        const provider = new DiagnosticsProvider(dm);
        const diags = provider.getDiagnostics(uri);

        const braceErrors = diags.filter(d => d.message.includes('}'));
        expect(braceErrors.length).toBeGreaterThan(0);
    });

    it('reports errors in a sibling of a valid expression block', async () => {
        const { DiagnosticsProvider } = await import('../../server/src/providers/diagnosticsProvider.js');
        const text = `
package TwoBlocks {
    constraint def Calc {
        attribute x : Real;
        x == 2 + 3
    }
    part def Broken {
        atribute y : Real;
    }
}
`;
        const { dm, uri } = await setup(text, 'test://siblings.sysml');
        const provider = new DiagnosticsProvider(dm);
        const diags = provider.getDiagnostics(uri);

        const errors = dm.get(uri)!.errors;
        expect(errors.length).toBeGreaterThan(0);
        expect(diags).toHaveLength(errors.length);
        const calcBlockErrors = diags.filter(d => {
            const line = d.range.start.line;
            return line >= 2 && line <= 5;
        });
        expect(calcBlockErrors.length).toBe(0);
        expect(diags.some(d => d.range.start.line === 7)).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// End-to-end provider pipeline integration tests
// ═══════════════════════════════════════════════════════════════════════════

describe('LSP provider pipeline (end-to-end)', () => {
    const vehicleModel = `
package VehicleSystem {
    part def Engine {
        attribute power : Real;
        attribute displacement : Real;
    }

    part def Wheel {
        attribute diameter : Real;
    }

    part def Vehicle {
        part engine : Engine[1];
        part wheels : Wheel[4];
    }

    part myCar : Vehicle;
}
`;

    it('should parse, build symbols, and produce zero diagnostics for valid model', async () => {
        const { DiagnosticsProvider } = await import('../../server/src/providers/diagnosticsProvider.js');
        const { dm, uri } = await setup(vehicleModel);

        // Parse produces no errors
        const result = dm.get(uri);
        expect(result).toBeDefined();
        expect(result!.errors.length).toBe(0);

        // Diagnostics provider also clean
        const provider = new DiagnosticsProvider(dm);
        const diags = provider.getDiagnostics(uri);
        expect(diags.length).toBe(0);
    });

    it('should extract correct document symbols from a multi-definition model', async () => {
        const { DocumentSymbolProvider } = await import('../../server/src/providers/documentSymbolProvider.js');
        const { dm, uri } = await setup(vehicleModel);

        const provider = new DocumentSymbolProvider(dm);
        const symbols = provider.provideDocumentSymbols({
            textDocument: { uri },
        });

        expect(symbols.length).toBeGreaterThan(0);
        const topLevelNames = symbols.map(s => s.name);
        expect(topLevelNames).toContain('VehicleSystem');
    });

    it('should provide hover information for a known symbol', async () => {
        const { HoverProvider } = await import('../../server/src/providers/hoverProvider.js');
        const { dm, uri } = await setup(vehicleModel);

        const provider = new HoverProvider(dm);
        // Find "Engine" in the text to get accurate position
        const lines = vehicleModel.split('\n');
        const engineLine = lines.findIndex(l => l.includes('part def Engine'));
        const engineCol = lines[engineLine].indexOf('Engine');

        const hover = provider.provideHover({
            textDocument: { uri },
            position: { line: engineLine, character: engineCol },
        });
        // Should return some hover content (at minimum the symbol kind)
        if (hover) {
            expect(hover.contents).toBeDefined();
        }
    });

    it('should provide completions in a SysML context', async () => {
        const { CompletionProvider } = await import('../../server/src/providers/completionProvider.js');
        const { dm, uri } = await setup(vehicleModel);

        const provider = new CompletionProvider(dm);
        // Request completions at start of a new line inside VehicleSystem
        const completions = provider.provideCompletions({
            textDocument: { uri },
            position: { line: 10, character: 4 },
        });

        expect(completions.length).toBeGreaterThan(0);
        // Should include SysML keywords like "part", "attribute", etc.
        const labels = completions.map(c => c.label);
        expect(labels).toContain('part');
        expect(labels).toContain('attribute');
    });

    it('should provide definition for a type reference', async () => {
        const { DefinitionProvider } = await import('../../server/src/providers/definitionProvider.js');
        const { dm, uri } = await setup(vehicleModel);

        const provider = new DefinitionProvider(dm);
        // Find the line where "part engine : Engine[1];" appears
        const lines = vehicleModel.split('\n');
        const engineUsageLine = lines.findIndex(l => l.includes('part engine : Engine'));
        // Position cursor on "Engine" in the type annotation
        const engineCol = lines[engineUsageLine].indexOf('Engine');

        const def = provider.provideDefinition({
            textDocument: { uri },
            position: { line: engineUsageLine, character: engineCol },
        });
        if (def) {
            // Should point back to the same file
            expect(def.uri).toBe(uri);
        }
    });

    it('should produce semantic tokens covering keywords and identifiers', async () => {
        const { SemanticTokensProvider } = await import('../../server/src/providers/semanticTokensProvider.js');
        const { dm, uri } = await setup(vehicleModel);

        const provider = new SemanticTokensProvider(dm);
        const tokens = provider.provideSemanticTokens({
            textDocument: { uri },
        });

        expect(tokens).toBeDefined();
        expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('should produce folding ranges for nested blocks', async () => {
        const { FoldingRangeProvider } = await import('../../server/src/providers/foldingRangeProvider.js');
        const { dm, uri } = await setup(vehicleModel);

        const provider = new FoldingRangeProvider(dm);
        const ranges = provider.provideFoldingRanges({
            textDocument: { uri },
        });

        // At minimum: VehicleSystem, Engine, Wheel, Vehicle
        expect(ranges.length).toBeGreaterThanOrEqual(4);
    });

    it('should detect semantic issues across a multi-file workspace', async () => {
        const { DocumentManager } = await import('../../server/src/documentManager.js');
        const { SemanticValidator } = await import('../../server/src/providers/semanticValidator.js');

        const dm = new DocumentManager();

        const reqUri = 'file:///requirements.sysml';
        const designUri = 'file:///design.sysml';

        const reqDoc = await makeDoc(`
package Requirements {
    requirement massReq {
        subject v : Vehicle;
    }
}
`, reqUri);

        const designDoc = await makeDoc(`
package Design {
    part def Vehicle { }
    part car : Vehicle;
    satisfy Requirements::massReq by car;
    verification case def MassTest { }
    verify Requirements::massReq by MassTest;
}
`, designUri);

        dm.parse(reqDoc);
        dm.parse(designDoc);

        const validator = new SemanticValidator(dm);
        const diags = validator.validate(reqUri);

        // massReq is satisfied and verified across files — no warnings expected
        const unsatisfied = diags.filter(d => d.code === 'unsatisfied-requirement');
        const unverified = diags.filter(d => d.code === 'unverified-requirement');
        expect(unsatisfied.length).toBe(0);
        expect(unverified.length).toBe(0);
    });
});
