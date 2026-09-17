/**
 * KerML §8.2.3.3.2's `REGULAR_COMMENT` body-text processing rules -- extracted as a standalone,
 * dependency-free function (not a `SymbolTable` method) so clients other than this server can
 * reuse the exact same cleanup instead of reimplementing it.
 */

/**
 * Strips a `/* ... *\/` comment/doc body down to its actual text: leading whitespace after the
 * opening delimiter, and -- on every subsequent line -- leading indentation, then one optional
 * `*` gutter marker, then one optional following space, all removed. Does *not* flow the result
 * into a single line; a genuine author-intended multi-line body (KerML: "all line terminators and
 * white space included as entered", beyond what this rule itself removes) stays multi-line -- a
 * consumer that wants a single-line *display* rendering should flow whitespace itself on top of
 * this, not fold that into the shared extraction (this codebase's own `SysMLNode.svelte` does
 * exactly that, display-side only, leaving the stored value from this function untouched).
 */
export function cleanDocumentationText(raw: string): string {
    const commentStart = raw.indexOf('/*');
    const commentEnd = raw.lastIndexOf('*/');
    if (commentStart < 0 || commentEnd < commentStart + 2) {
        return raw.replace(/^(?:doc|comment)\s*/, '').replace(/^\/\/\s?/, '').trim();
    }

    const body = raw.substring(commentStart + 2, commentEnd);
    const lines = body.split(/\r?\n/);

    // Strip whitespace immediately following the opening delimiter.
    if (lines.length > 0) {
        lines[0] = lines[0].replace(/^\s+/, '');
    }

    // On each subsequent line: strip indentation, then one optional '*',
    // then one optional space, exactly as prescribed by the specification.
    for (let i = 1; i < lines.length; i++) {
        lines[i] = lines[i].replace(/^[^\S\r\n]*/, '');
        if (lines[i].startsWith('*')) lines[i] = lines[i].slice(1);
        if (lines[i].startsWith(' ')) lines[i] = lines[i].slice(1);
    }

    return lines.join('\n').trim();
}
