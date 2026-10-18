import { Token } from 'antlr4ng';
import { SysMLv2Lexer } from '../generated/SysMLv2Lexer.js';

/** Keywords a declared name can directly follow (`part def <name>`, `in attribute <name>`). */
export const NAME_PRECEDING_KEYWORDS: ReadonlySet<number> = new Set([
    // ── SysML definition/usage element keywords ──
    SysMLv2Lexer.PART, SysMLv2Lexer.PORT, SysMLv2Lexer.ITEM,
    SysMLv2Lexer.ATTRIBUTE, SysMLv2Lexer.ACTION, SysMLv2Lexer.CALC,
    SysMLv2Lexer.STATE, SysMLv2Lexer.CONSTRAINT, SysMLv2Lexer.REQUIREMENT,
    SysMLv2Lexer.CONCERN, SysMLv2Lexer.CASE, SysMLv2Lexer.ANALYSIS,
    SysMLv2Lexer.VERIFICATION, SysMLv2Lexer.VIEW, SysMLv2Lexer.VIEWPOINT,
    SysMLv2Lexer.RENDERING, SysMLv2Lexer.METADATA, SysMLv2Lexer.PACKAGE,
    SysMLv2Lexer.NAMESPACE, SysMLv2Lexer.ENUM, SysMLv2Lexer.ALLOCATION,
    SysMLv2Lexer.CONNECTION, SysMLv2Lexer.INTERFACE, SysMLv2Lexer.OCCURRENCE,
    SysMLv2Lexer.INDIVIDUAL, SysMLv2Lexer.FLOW, SysMLv2Lexer.SUCCESSION,
    SysMLv2Lexer.BINDING, SysMLv2Lexer.MESSAGE, SysMLv2Lexer.TRANSITION,
    // ── KerML element keywords ──
    SysMLv2Lexer.TYPE, SysMLv2Lexer.CLASSIFIER, SysMLv2Lexer.DATATYPE,
    SysMLv2Lexer.CLASS, SysMLv2Lexer.STRUCT, SysMLv2Lexer.ASSOC,
    SysMLv2Lexer.METACLASS, SysMLv2Lexer.INTERACTION, SysMLv2Lexer.BEHAVIOR,
    SysMLv2Lexer.FUNCTION, SysMLv2Lexer.PREDICATE, SysMLv2Lexer.FEATURE,
    SysMLv2Lexer.CONNECTOR, SysMLv2Lexer.STEP, SysMLv2Lexer.EXPR,
    SysMLv2Lexer.BOOL, SysMLv2Lexer.INV, SysMLv2Lexer.MULTIPLICITY,
    // ── Annotation / membership keywords ──
    SysMLv2Lexer.ALIAS, SysMLv2Lexer.COMMENT, SysMLv2Lexer.DOC,
    SysMLv2Lexer.REP, SysMLv2Lexer.DEPENDENCY, SysMLv2Lexer.IMPORT,
    // ── Keyword + DEF / keyword modifiers ──
    SysMLv2Lexer.DEF, SysMLv2Lexer.REF, SysMLv2Lexer.ALL,
    // ── Feature prefix / visibility modifiers ──
    SysMLv2Lexer.ABSTRACT, SysMLv2Lexer.VARIATION, SysMLv2Lexer.DERIVED,
    SysMLv2Lexer.COMPOSITE, SysMLv2Lexer.CONST, SysMLv2Lexer.CONSTANT,
    SysMLv2Lexer.VAR, SysMLv2Lexer.MEMBER, SysMLv2Lexer.RETURN,
    SysMLv2Lexer.PUBLIC, SysMLv2Lexer.PRIVATE, SysMLv2Lexer.PROTECTED,
    // ── Directionality ──
    SysMLv2Lexer.IN, SysMLv2Lexer.OUT, SysMLv2Lexer.INOUT, SysMLv2Lexer.END,
    // ── Actor / role keywords ──
    SysMLv2Lexer.ACTOR, SysMLv2Lexer.STAKEHOLDER, SysMLv2Lexer.SUBJECT,
    SysMLv2Lexer.VARIANT, SysMLv2Lexer.SNAPSHOT, SysMLv2Lexer.TIMESLICE,
    // ── Action control node keywords ──
    SysMLv2Lexer.FORK, SysMLv2Lexer.JOIN, SysMLv2Lexer.MERGE,
    SysMLv2Lexer.DECIDE,
    // ── Reference-preceding keywords ──
    SysMLv2Lexer.PERFORM, SysMLv2Lexer.EXHIBIT, SysMLv2Lexer.INCLUDE,
    SysMLv2Lexer.SATISFY, SysMLv2Lexer.ASSERT, SysMLv2Lexer.VERIFY,
    SysMLv2Lexer.RENDER, SysMLv2Lexer.CONNECT, SysMLv2Lexer.ALLOCATE,
    SysMLv2Lexer.BIND, SysMLv2Lexer.EXPOSE, SysMLv2Lexer.EVENT,
    // ── Succession / flow keywords ──
    SysMLv2Lexer.FIRST, SysMLv2Lexer.THEN, SysMLv2Lexer.TO,
    SysMLv2Lexer.FROM,
    // ── Relationship keywords ──
    SysMLv2Lexer.REDEFINES, SysMLv2Lexer.SUBSETS,
    SysMLv2Lexer.SPECIALIZES, SysMLv2Lexer.REFERENCES,
    SysMLv2Lexer.CONJUGATES, SysMLv2Lexer.CHAINS, SysMLv2Lexer.CROSSES,
    SysMLv2Lexer.UNIONS, SysMLv2Lexer.INTERSECTS, SysMLv2Lexer.DIFFERENCES,
    // ── KerML relationship element keywords ──
    SysMLv2Lexer.SPECIALIZATION, SysMLv2Lexer.CONJUGATION,
    SysMLv2Lexer.DISJOINING, SysMLv2Lexer.INVERTING,
    SysMLv2Lexer.FEATURING, SysMLv2Lexer.TYPING, SysMLv2Lexer.REDEFINITION,
    SysMLv2Lexer.SUBTYPE, SysMLv2Lexer.SUBCLASSIFIER,
    SysMLv2Lexer.SUBSET, SysMLv2Lexer.CONJUGATE,
    SysMLv2Lexer.DISJOINT, SysMLv2Lexer.INVERSE,
    // ── Requirement / state body keywords ──
    SysMLv2Lexer.ASSUME, SysMLv2Lexer.REQUIRE, SysMLv2Lexer.FRAME,
    SysMLv2Lexer.OBJECTIVE, SysMLv2Lexer.ENTRY, SysMLv2Lexer.DO,
    SysMLv2Lexer.EXIT,
    // ── Misc keywords preceding names ──
    SysMLv2Lexer.ACCEPT, SysMLv2Lexer.SEND, SysMLv2Lexer.ASSIGN,
    SysMLv2Lexer.TERMINATE, SysMLv2Lexer.FOR, SysMLv2Lexer.ABOUT,
    SysMLv2Lexer.BY, SysMLv2Lexer.FILTER, SysMLv2Lexer.NEW,
    SysMLv2Lexer.META, SysMLv2Lexer.OF,
    // ── Punctuation that precedes names ──
    SysMLv2Lexer.COLON, SysMLv2Lexer.COLON_GT, SysMLv2Lexer.COLON_GT_GT,
    SysMLv2Lexer.COLON_COLON, SysMLv2Lexer.COLON_COLON_GT,
    SysMLv2Lexer.GT, SysMLv2Lexer.FAT_ARROW, SysMLv2Lexer.TILDE,
    SysMLv2Lexer.COMMA, SysMLv2Lexer.HASH, SysMLv2Lexer.AT,
]);

/**
 * The message for a syntax error on a reserved keyword used as a name (KerML 8.2.2.6), or
 * `undefined` when `token` is not one. It is one only where a declaration keyword precedes it and
 * no name follows it: a name never directly follows another name, so in `in attribute in y` or
 * `succession flow def SF` the keyword is misplaced, not a name.
 */
export function keywordAsNameMessage(previous: Token | undefined, token: Token, next: Token | undefined): string | undefined {
    const word = token.text;
    if (token.type === SysMLv2Lexer.IDENTIFIER || token.type === Token.EOF || !word || !/^[a-z]+$/.test(word)) return undefined;
    if (previous === undefined || !NAME_PRECEDING_KEYWORDS.has(previous.type)) return undefined;
    if (next?.type === SysMLv2Lexer.IDENTIFIER) return undefined;
    const suggestion = 'my' + word.charAt(0).toUpperCase() + word.slice(1);
    return `'${word}' is a reserved SysML keyword and cannot be used as a name. Consider renaming it (e.g., '${suggestion}').`;
}
