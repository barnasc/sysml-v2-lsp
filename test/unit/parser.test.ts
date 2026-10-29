import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

// Note: These tests require the ANTLR-generated parser to be present.
// Run `npm run generate` before running tests.

describe('Parser', () => {
    const fixturesDir = join(__dirname, '..', 'fixtures');

    // Load the DFA snapshot before tests to avoid cold-DFA timeouts.
    beforeAll(async () => {
        const { loadDFASnapshot } = await import('../../server/src/parser/dfaLoader.js');
        loadDFASnapshot();
    });

    it('should parse a valid vehicle model without errors', async () => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        const text = readFileSync(join(fixturesDir, 'valid', 'vehicle.sysml'), 'utf-8');
        const result = parseDocument(text);

        expect(result.tree).not.toBeNull();
        expect(result.errors.length).toBe(0);
    });

    it('should parse a valid camera model without errors', async () => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        const text = readFileSync(join(fixturesDir, 'valid', 'camera.sysml'), 'utf-8');
        const result = parseDocument(text);

        expect(result.tree).not.toBeNull();
        expect(result.errors.length).toBe(0);
    });

    it('should report errors for invalid syntax', async () => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        const text = readFileSync(join(fixturesDir, 'invalid', 'syntax-error.sysml'), 'utf-8');
        const result = parseDocument(text);

        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should require explicit import visibility', async () => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');

        expect(parseDocument('package Test { private import Library::*; }').errors).toEqual([]);
        expect(parseDocument('package Test { import Library::*; }').errors.length).toBeGreaterThan(0);
    });

    // Upstream Fix 54 bridges the formal SysML 2.0 8.2.2.9.2/8.2.2.17 BNF gap:
    // nonBehaviorBodyItem admits endOccurrenceUsageElement, as the Pilot and
    // September's Flows::messages require.
    it('should parse the September Flows::messages typed ends', async () => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        const { SysMLv2Parser } = await import('../../server/src/generated/SysMLv2Parser.js');
        const result = parseDocument(`package Flows {
    abstract action messages : Message[0..*] nonunique :> transfers, actions {
        end occurrence source : Occurrence :>> Message::source, transfers::source;
        end occurrence target : Occurrence :>> Message::target, transfers::target;
    }
}`);
        expect(result.errors.map(error => error.message)).toEqual([]);
        expect(result.tree).not.toBeNull();
        const pending: import('antlr4ng').ParseTree[] = [result.tree!];
        let ends = 0;
        while (pending.length > 0) {
            const node = pending.pop()!;
            if ('ruleIndex' in node && node.ruleIndex === SysMLv2Parser.RULE_endOccurrenceUsageElement) ends++;
            for (let i = 0; i < node.getChildCount(); i++) {
                const child = node.getChild(i);
                if (child) pending.push(child);
            }
        }
        expect(ends).toBe(2);
    });

    it.each([
        'action def A', 'action a', 'state def S', 'state s', 'calc def C',
        'calc c', 'analysis def A', 'analysis a', 'use case def U', 'verification def V',
    ])('should accept a typed end in %s', async owner => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        expect(parseDocument(`package P {
    ${owner} {
        private end occurrence source : Occurrence :>> Base::source;
    }
}`).errors.map(error => error.message)).toEqual([]);
    });

    it.each([
        'end occurrence source : ;',
        'end occurrence source : Occurrence :>> ;',
        'end [0..] occurrence source : Occurrence;',
        'end end occurrence source : Occurrence;',
        'end occurrence source : Occurrence',
    ])('should still reject malformed typed end %s', async declaration => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        expect(parseDocument(`package P { action a { ${declaration} } }`).errors.length).toBeGreaterThan(0);
    });

    it('should return a token stream', async () => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        const result = parseDocument('package Test { }');

        expect(result.tokenStream).toBeDefined();
        result.tokenStream.fill();
        expect(result.tokenStream.getTokens().length).toBeGreaterThan(0);
    });

    it.each([
        ['a + b * c', '+', 1, '*'],
        ['a * b + c', '+', 0, '*'],
        ['a ** b ** c', '**', 1, '**'],
        ['a or b and c', 'or', 1, 'and'],
    ] as const)('should preserve operator grouping in %s', async (text, root, childIndex, nested) => {
        const { CharStream, CommonTokenStream, Token } = await import('antlr4ng');
        const { SysMLv2Lexer } = await import('../../server/src/generated/SysMLv2Lexer.js');
        const { SysMLv2Parser } = await import('../../server/src/generated/SysMLv2Parser.js');
        const lexer = new SysMLv2Lexer(CharStream.fromString(text));
        const parser = new SysMLv2Parser(new CommonTokenStream(lexer));
        const expression = parser.ownedExpression();

        expect(parser.numberOfSyntaxErrors).toBe(0);
        expect(parser.getCurrentToken().type).toBe(Token.EOF);
        expect(expression.getChild(1)?.getText()).toBe(root);
        expect(expression.ownedExpression()[childIndex].getChild(1)?.getText()).toBe(nested);
    });

    it.each([
        'a + if b ? c else d',
        'not if a ? b else c',
        '(as MetadataType).isMandatory',
    ])('should accept the expression %s in a document', async expression => {
        const { parseDocument } = await import('../../server/src/parser/parseDocument.js');
        const result = parseDocument(`package Test { attribute value = ${expression}; }`);

        expect(result.errors).toEqual([]);
    });
});
