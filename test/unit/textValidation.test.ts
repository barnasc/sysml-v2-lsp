/**
 * `sysml/validateText`: validating one or more texts against the elaborated
 * model without changing the server's state.
 */
import { describe, expect, it } from 'vitest';

/** A document manager holding `entries`, with a text validator over it. */
async function setup(entries: { uri: string; text: string }[]) {
    const { TextDocument } = await import('vscode-languageserver-textdocument');
    const { DocumentManager } = await import('../../server/src/documentManager.js');
    const { SemanticValidator } = await import('../../server/src/providers/semanticValidator.js');
    const { TextValidationProvider } = await import('../../server/src/providers/textValidationProvider.js');
    const dm = new DocumentManager();
    for (const { uri, text } of entries) dm.parse(TextDocument.create(uri, 'sysml', 1, text));
    const semanticValidator = new SemanticValidator(dm);
    const validator = new TextValidationProvider(dm, semanticValidator);
    /** The diagnostics of one text, validated as the content of `uri` (a new document by default). */
    const validateOne = (text: string, uri = 'file:///ws/new.sysml') => validator.validate({ documents: [{ uri, text }] }).documents[0].diagnostics;
    return { dm, semanticValidator, validator, validateOne };
}

const codes = (diagnostics: { code?: unknown }[]) => diagnostics.map(d => d.code);

/** The InvalidParams error `run` throws (JSON-RPC code -32602, as the client receives it). */
function invalidParams(run: () => unknown): Error {
    try {
        run();
    } catch (error) {
        expect(error).toMatchObject({ code: -32602 });
        return error as Error;
    }
    throw new Error('expected InvalidParams');
}

describe('TextValidationProvider', () => {
    it('reports syntax errors', async () => {
        const { validateOne } = await setup([]);
        const diagnostics = validateOne('package P { part def A }');
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0].range.start.line).toBe(0);
    });

    it('resolves references to other documents of the workspace', async () => {
        const { validateOne } = await setup([{ uri: 'file:///ws/engine.sysml', text: 'package Parts { part def Engine; }' }]);
        expect(codes(validateOne('package Car { private import Parts::*; part engine : Engine; }'))).not.toContain('unresolved-type');
        expect(codes(validateOne('package Car { private import Parts::*; part gearbox : Gearbox; }'))).toContain('unresolved-type');
    });

    it('validates a text as the new content of its uri\'s document, not as a second copy', async () => {
        const uri = 'file:///ws/engine.sysml';
        const { validateOne } = await setup([{ uri, text: 'part def Engine;' }]);

        // As a new document, a second top-level Engine clashes with the existing one ...
        expect(codes(validateOne('part def Engine;'))).toContain('ambiguous-namespace-name');
        // ... as the new content of engine.sysml, it replaces it.
        expect(codes(validateOne('part def Engine;', uri))).not.toContain('ambiguous-namespace-name');
    });

    it('leaves documents, symbols and later diagnostics unchanged', async () => {
        const uri = 'file:///ws/parts.sysml';
        const { dm, semanticValidator, validateOne } = await setup([
            { uri, text: 'package Parts { part def Engine; }' },
            { uri: 'file:///ws/car.sysml', text: 'package Car { part engine : Parts::Engine; }' },
        ]);
        const before = semanticValidator.validate('file:///ws/car.sysml');
        const urisBefore = dm.getUris();

        // Validating a version of parts.sysml without Engine must not leak into car.sysml.
        validateOne('package Parts { }', uri);
        validateOne('package Extra { part def Engine; }');

        expect(dm.getUris()).toEqual(urisBefore);
        expect(dm.getText(uri)).toBe('package Parts { part def Engine; }');
        expect(dm.getVersion(uri)).toBe(1);
        const qualifiedNames = dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName);
        expect(qualifiedNames).toContain('Parts::Engine');
        expect(qualifiedNames).not.toContain('Extra::Engine');
        expect(semanticValidator.validate('file:///ws/car.sysml')).toEqual(before);
    });

    it('restores every document when validation throws', async () => {
        const uri = 'file:///ws/parts.sysml';
        const { dm } = await setup([{ uri, text: 'package Parts { part def Engine; }' }]);
        const documents = [
            { uri, text: 'package Other;' },
            { uri: 'file:///ws/new.sysml', text: 'package New;' },
        ];
        expect(() => dm.withTexts(documents, () => { throw new Error('boom'); })).toThrow('boom');
        expect(dm.getUris()).toEqual([uri]);
        expect(dm.getText(uri)).toBe('package Parts { part def Engine; }');
        expect(dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName)).toContain('Parts::Engine');
    });

    it('includes the keyword checks, like an open document', async () => {
        const { validateOne } = await setup([]);
        expect(codes(validateOne("part def '';"))).toContain('empty-name');
    });

    it('changes nothing when a text cannot be parsed: every text is parsed before anything changes', async () => {
        const uri = 'file:///ws/parts.sysml';
        const { dm } = await setup([{ uri, text: 'package Parts { part def Engine; }' }]);
        let ran = false;
        const documents = [
            { uri, text: 'package Other;' },
            { uri: 'file:///ws/new.sysml', text: 42 as unknown as string },
        ];
        expect(() => dm.withTexts(documents, () => { ran = true; })).toThrow();
        expect(ran).toBe(false);
        expect(dm.getUris()).toEqual([uri]);
        expect(dm.getText(uri)).toBe('package Parts { part def Engine; }');
        expect(dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName)).toContain('Parts::Engine');
    });

    it('keeps version-keyed caches apart: the temporary texts never reuse a real document version', async () => {
        // The semantic validator caches which requirements are satisfied, keyed by every document's version.
        const requirements = { uri: 'file:///ws/requirements.sysml', text: 'requirement def MaxMass;\nrequirement maxMass : MaxMass;\n' };
        const satisfaction = { uri: 'file:///ws/satisfaction.sysml', text: 'part vehicle;\nsatisfy maxMass by vehicle;\n' };
        const { semanticValidator, validator } = await setup([requirements, satisfaction]);
        expect(codes(semanticValidator.validate(requirements.uri))).not.toContain('unsatisfied-requirement');

        // Without the satisfy statement, maxMass is unsatisfied. Had the temporary texts kept the real
        // versions (1), the cache filled above would still say it is satisfied.
        const result = validator.validate({ documents: [{ uri: satisfaction.uri, text: 'part vehicle;\n' }, requirements] });
        expect(codes(result.documents[1].diagnostics)).toContain('unsatisfied-requirement');

        // And the cache filled during validation doesn't leak into the real documents afterwards.
        expect(codes(semanticValidator.validate(requirements.uri))).not.toContain('unsatisfied-requirement');
    });

    it('works with documents cached but not parsed yet (as open documents are while the parse worker runs)', async () => {
        const { dm, validateOne } = await setup([]);
        const uri = 'file:///ws/parts.sysml';
        dm.cacheTextOnly(uri, 3, 'package Parts { part def Engine; }');

        expect(codes(validateOne('package Car { private import Parts::*; part engine : Engine; }'))).not.toContain('unresolved-type');
        expect(codes(validateOne('part def Wheel;', uri))).not.toContain('ambiguous-namespace-name');

        expect(dm.getText(uri)).toBe('package Parts { part def Engine; }');
        expect(dm.getVersion(uri)).toBe(3);
        expect(dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName)).toContain('Parts::Engine');
        expect(dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName)).not.toContain('Wheel');
    });

    describe('the same text under the same uri as an existing document', () => {
        const uri = 'file:///ws/vehicle.sysml';
        const text = 'package Vehicle {\n    part def Engine;\n    part engine : Engine;\n    part gearbox : Gearbox;\n}\n';

        /** The diagnostics the document itself gets: syntax, keyword and semantic, as the server publishes them. */
        async function ownDiagnostics(dm: Awaited<ReturnType<typeof setup>>['dm'], semanticValidator: Awaited<ReturnType<typeof setup>>['semanticValidator']) {
            const { DiagnosticsProvider } = await import('../../server/src/providers/diagnosticsProvider.js');
            const { validateKeywords } = await import('../../server/src/providers/keywordValidator.js');
            return [
                ...new DiagnosticsProvider(dm).getDiagnostics(uri),
                ...validateKeywords(dm.get(uri)!),
                ...semanticValidator.validate(uri),
            ];
        }

        it('gives exactly the diagnostics the document has, and changes nothing', async () => {
            const { dm, semanticValidator, validateOne } = await setup([
                { uri, text },
                { uri: 'file:///ws/other.sysml', text: 'package Other { private import Vehicle::*; part e : Engine; }' },
            ]);
            const own = await ownDiagnostics(dm, semanticValidator);
            const symbolsBefore = dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName).sort();
            const otherBefore = semanticValidator.validate('file:///ws/other.sysml');

            const diagnostics = validateOne(text, uri);
            expect(diagnostics).toEqual(own);
            expect(codes(diagnostics)).toContain('unresolved-type');
            expect(codes(diagnostics)).not.toContain('ambiguous-namespace-name');
            expect(codes(diagnostics)).not.toContain('duplicate-definition');

            expect(dm.getText(uri)).toBe(text);
            expect(dm.getVersion(uri)).toBe(1);
            expect(dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName).sort()).toEqual(symbolsBefore);
            expect(semanticValidator.validate('file:///ws/other.sysml')).toEqual(otherBefore);
            expect(await ownDiagnostics(dm, semanticValidator)).toEqual(own);
        });

        it('recognizes the document under another spelling of its uri (Windows drive letter)', async () => {
            const scanned = 'file:///c:/ws/vehicle.sysml';
            const { dm, validateOne } = await setup([{ uri: scanned, text }]);
            expect(codes(validateOne(text, 'file:///C%3A/ws/vehicle.sysml'))).not.toContain('ambiguous-namespace-name');
            expect(dm.getUris()).toEqual([scanned]);
        });
    });

    describe('text that is not SysML v2', () => {
        it.each([
            ['prose', 'This is not a model, just a sentence.'],
            ['JSON', '{ "parts": [ { "name": "engine" } ] }'],
            ['Python', 'def engine():\n    return 42\n'],
            ['XMI', '<?xml version="1.0"?>\n<xmi:XMI xmlns:xmi="http://www.omg.org/XMI"><uml:Model name="M"/></xmi:XMI>'],
            ['control characters', '\u0000\u0001 part \u0007 def'],
        ])('reports %s as syntax errors, without throwing or changing anything', async (_kind, text) => {
            const uri = 'file:///ws/parts.sysml';
            const { dm, validateOne } = await setup([{ uri, text: 'package Parts { part def Engine; }' }]);

            const diagnostics = validateOne(text, uri);
            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics.every(d => d.range.start.line >= 0 && d.message.length > 0)).toBe(true);

            expect(dm.getText(uri)).toBe('package Parts { part def Engine; }');
            expect(dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName)).toContain('Parts::Engine');
        });

        it('accepts empty and blank text as an empty model', async () => {
            const { validateOne } = await setup([]);
            expect(validateOne('')).toEqual([]);
            expect(validateOne('  \n\t\n')).toEqual([]);
        });
    });

    describe('several documents at once', () => {
        const motors = { uri: 'file:///ws/motors.sysml', text: 'package Motors { part def Motor; }' };
        const vehicle = { uri: 'file:///ws/vehicle.sysml', text: 'package Vehicle { private import Motors::*; part motor : Motor; }' };

        it('resolves references between the documents, which one at a time do not', async () => {
            const { validator, validateOne } = await setup([]);
            const together = validator.validate({ documents: [motors, vehicle] });
            expect(together.documents.map(d => d.uri)).toEqual([motors.uri, vehicle.uri]);
            expect(together.documents.flatMap(d => codes(d.diagnostics))).not.toContain('unresolved-type');

            expect(codes(validateOne(vehicle.text, vehicle.uri))).toContain('unresolved-type');
        });

        it('gives each document its own diagnostics, under the uri the client sent', async () => {
            const scanned = 'file:///c:/ws/motors.sysml';
            const { validator } = await setup([{ uri: scanned, text: motors.text }]);
            const result = validator.validate({
                documents: [
                    { uri: 'file:///C%3A/ws/motors.sysml', text: 'package Motors { part def Motor; part m : Missing; }' },
                    { uri: 'file:///c:/ws/vehicle.sysml', text: vehicle.text },
                ],
            });
            expect(result.documents.map(d => d.uri)).toEqual(['file:///C%3A/ws/motors.sysml', 'file:///c:/ws/vehicle.sysml']);
            expect(codes(result.documents[0].diagnostics)).toContain('unresolved-type');
            expect(codes(result.documents[1].diagnostics)).not.toContain('unresolved-type');
            // The motors text replaced the scanned document (another spelling of its uri): no clash.
            expect(result.documents.flatMap(d => codes(d.diagnostics))).not.toContain('ambiguous-namespace-name');
        });

        it('replaces several existing documents at once, and changes nothing', async () => {
            const { dm, semanticValidator, validator } = await setup([motors, vehicle]);
            const symbolsBefore = dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName).sort();
            const vehicleBefore = semanticValidator.validate(vehicle.uri);

            // Rename Motor to Engine in both documents: valid only when both change together.
            const result = validator.validate({
                documents: [
                    { uri: motors.uri, text: 'package Motors { part def Engine; }' },
                    { uri: vehicle.uri, text: 'package Vehicle { private import Motors::*; part motor : Engine; }' },
                ],
            });
            expect(result.documents.flatMap(d => codes(d.diagnostics))).not.toContain('unresolved-type');

            expect(dm.getUris()).toEqual([motors.uri, vehicle.uri]);
            expect(dm.getText(motors.uri)).toBe(motors.text);
            expect(dm.getText(vehicle.uri)).toBe(vehicle.text);
            expect(dm.getWorkspaceSymbolTable().getAllSymbols().map(s => s.qualifiedName).sort()).toEqual(symbolsBefore);
            expect(semanticValidator.validate(vehicle.uri)).toEqual(vehicleBefore);
        });
    });

    describe('invalid parameters', () => {
        const motors = { uri: 'file:///ws/motors.sysml', text: 'package Motors { part def Motor; }' };

        it.each([
            ['no parameters at all', undefined, '"documents" must be a non-empty array'],
            ['no documents', {}, '"documents" must be a non-empty array'],
            ['an empty list', { documents: [] }, '"documents" must be a non-empty array'],
            ['documents that are not a list', { documents: motors }, '"documents" must be a non-empty array'],
            ['a document without text', { documents: [{ uri: motors.uri }] }, 'documents[0] needs "text"'],
            ['text that is not a string', { documents: [{ uri: motors.uri, text: 42 }] }, 'documents[0] needs "text"'],
            ['null text', { documents: [{ uri: motors.uri, text: null }] }, 'documents[0] needs "text"'],
            ['a document without uri', { documents: [{ text: 'package A;' }] }, 'documents[0] needs "uri"'],
            ['a uri that is not a string', { documents: [{ uri: 7, text: 'package A;' }] }, 'documents[0] needs "uri"'],
            ['an empty uri', { documents: [{ uri: '', text: 'package A;' }] }, 'documents[0] needs "uri"'],
            ['a blank uri', { documents: [{ uri: '  ', text: 'package A;' }] }, 'documents[0] needs "uri"'],
            ['the same document twice', { documents: [motors, { ...motors, text: 'package B;' }] }, 'documents[0] and documents[1] name the same document'],
            [
                'the same document under two spellings',
                { documents: [{ uri: 'file:///c:/ws/a.sysml', text: '' }, { uri: 'file:///C%3A/ws/a.sysml', text: '' }] },
                'name the same document',
            ],
        ])('answers InvalidParams for %s, changing nothing', async (_case, params, mentions) => {
            const { dm, validator } = await setup([motors]);
            expect(invalidParams(() => validator.validate(params as never)).message).toContain(mentions);
            expect(dm.getUris()).toEqual([motors.uri]);
            expect(dm.getText(motors.uri)).toBe(motors.text);
        });
    });
});
