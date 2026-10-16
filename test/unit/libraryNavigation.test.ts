/**
 * Go-to-definition on standard-library names, quoted short names (`'Ω'`,
 * SI.sysml: `attribute <'Ω'> ohm`) included, with the bundled library loaded.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, describe, expect, it } from 'vitest';

const TEXT = `package P {
    private import SI::*;
    private import SI::'Ω';
    attribute byShortName = 'Ω';
    attribute byName = ohm;
    attribute qualifiedShortName = SI::'Ω';
    attribute qualifiedName = SI::ohm;
    attribute subsetting :> 'Ω';
    attribute quantity = 1 ['Ω'];
    attribute unquotedShortName = kg;
    attribute missing = 'Ωx';
}
`;

/** The 0-based line of SI.sysml declaring `declaration`. */
function lineInSI(declaration: string): number {
    const si = resolve(__dirname, '..', '..', 'sysml.library', 'Domain Libraries', 'Quantities and Units', 'SI.sysml');
    return readFileSync(si, 'utf8').split('\n').findIndex(line => line.includes(declaration));
}

/** Go-to-definition at `column` (0-based) of the line of TEXT starting with `linePrefix`. */
async function definitionAt(linePrefix: string, column: number) {
    const { TextDocument } = await import('vscode-languageserver-textdocument');
    const { DocumentManager } = await import('../../server/src/documentManager.js');
    const { DefinitionProvider } = await import('../../server/src/providers/definitionProvider.js');
    const uri = 'test://library-navigation.sysml';
    const dm = new DocumentManager();
    dm.parse(TextDocument.create(uri, 'sysml', 1, TEXT));
    const line = TEXT.split('\n').findIndex(l => l.trimStart().startsWith(linePrefix));
    expect(line).toBeGreaterThanOrEqual(0);
    return new DefinitionProvider(dm).provideDefinition({ textDocument: { uri }, position: { line, character: column } });
}

/** The column of the last `text` on the line of TEXT starting with `linePrefix`. */
function columnOf(linePrefix: string, text: string): number {
    const line = TEXT.split('\n').find(l => l.trimStart().startsWith(linePrefix))!;
    return line.lastIndexOf(text);
}

describe('Definition Provider: standard-library short names', () => {
    beforeAll(async () => {
        const { initLibraryIndex } = await import('../../server/src/library/libraryIndex.js');
        initLibraryIndex(resolve(__dirname, '..', '..', 'dist', 'server'));
    });

    it.each([
        ['a quoted short name in a value', 'attribute byShortName', "'Ω'"],
        ['the name of the same element', 'attribute byName', 'ohm'],
        ['a qualified quoted short name', 'attribute qualifiedShortName', "'Ω'"],
        ['a qualified name', 'attribute qualifiedName', 'ohm'],
        ['a quoted short name in a membership import', "private import SI::'Ω'", "'Ω'"],
        ['a quoted short name in a subsetting', 'attribute subsetting', "'Ω'"],
        ['a quoted short name as the unit of a quantity', 'attribute quantity', "'Ω'"],
    ])('goes to the declaration of ohm from %s', async (_case, linePrefix, name) => {
        const start = columnOf(linePrefix, name);
        // On the opening quote (or first character) and inside the name.
        for (const column of [start, start + 1]) {
            const location = await definitionAt(linePrefix, column);
            expect(location).not.toBeNull();
            expect(fileURLToPath(location!.uri)).toMatch(/SI\.sysml$/);
            expect(location!.range.start.line).toBe(lineInSI("attribute <'Ω'> ohm"));
        }
    });

    it('goes to the declaration of an unquoted short name (kg)', async () => {
        const location = await definitionAt('attribute unquotedShortName', columnOf('attribute unquotedShortName', 'kg'));
        expect(location).not.toBeNull();
        expect(fileURLToPath(location!.uri)).toMatch(/SI\.sysml$/);
        expect(location!.range.start.line).toBe(lineInSI('attribute <kg> kilogram'));
    });

    it('finds nothing for a quoted name the library does not have', async () => {
        const location = await definitionAt('attribute missing', columnOf('attribute missing', "'Ωx'") + 1);
        expect(location).toBeNull();
    });
});
