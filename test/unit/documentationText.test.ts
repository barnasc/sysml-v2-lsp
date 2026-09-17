import { describe, expect, it } from 'vitest';
import { cleanDocumentationText } from '../../server/src/symbols/documentationText.js';

describe('cleanDocumentationText (KerML 8.2.3.3.2 gutter-stripping)', () => {
    it('strips a single-line body down to its trimmed text', () => {
        expect(cleanDocumentationText('/* Single line doc */')).toBe('Single line doc');
    });

    it('strips leading indentation, an optional `*` gutter, and one optional following space per line', () => {
        const raw = ['/* Line one', ' * Line two', ' *   extra-indented line three', ' */'].join('\n');
        expect(cleanDocumentationText(raw)).toBe('Line one\nLine two\n  extra-indented line three');
    });

    it('preserves genuine multi-line structure -- does not flow lines into one', () => {
        const raw = ['/* Line one', ' * Line two', ' * Line three', ' */'].join('\n');
        expect(cleanDocumentationText(raw)).toBe('Line one\nLine two\nLine three');
    });

    it('handles a line with no `*` gutter (bare indentation only)', () => {
        const raw = ['/* Line one', '   Line two (no star)', ' */'].join('\n');
        expect(cleanDocumentationText(raw)).toBe('Line one\nLine two (no star)');
    });

    it('falls back to a plain trim for text with no /* */ delimiters', () => {
        expect(cleanDocumentationText('// a line comment')).toBe('a line comment');
        expect(cleanDocumentationText('doc plain text')).toBe('plain text');
    });
});
