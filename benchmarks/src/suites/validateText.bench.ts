/**
 * `sysml/validateText` benchmark suite — measures how long one request
 * keeps the server busy. The request runs synchronously on the main
 * thread, so its duration is how long every request queued behind it
 * waits: the server's responsiveness while it runs.
 *
 * - `workspace/*`: the edited content of one document, by workspace size;
 * - `text/*`: one new document, by text size;
 * - `documents/*`: several new documents in one request;
 * - `limits/defaults`: the largest request the default limits accept;
 * - `followUp/*`: the next semantic validation of an open document, with
 *   and without a request before it (the state the request drops is rebuilt).
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentManager } from '../../../server/src/documentManager.js';
import { parseDocument } from '../../../server/src/parser/parseDocument.js';
import { SemanticValidator } from '../../../server/src/providers/semanticValidator.js';
import {
    DEFAULT_TEXT_VALIDATION_SETTINGS,
    lineCount,
    TextValidationProvider,
    type ValidateTextDocument,
} from '../../../server/src/providers/textValidationProvider.js';
import { benchmarkFn, type BenchmarkOptions, type BenchmarkResult } from '../utils/harness.js';
import { computeStats } from '../utils/stats.js';
import type { SuiteReport } from '../reporters/jsonReporter.js';

/** Lines one block of `generatePackage` takes. */
const BLOCK_LINES = 6;

/**
 * A syntax-valid package of about `lines` lines: part definitions, each
 * using the previous one, and usages of them. With `imported`, it imports
 * that package and uses its first definition, so references cross files.
 */
function generatePackage(name: string, lines: number, imported?: string): string {
    const out = [`package ${name} {`];
    if (imported) out.push(`    private import ${imported}::*;`);
    const blocks = Math.max(1, Math.round((lines - out.length - 1) / BLOCK_LINES));
    for (let k = 0; k < blocks; k++) {
        out.push(`    part def ${name}Block${k} {`);
        out.push('        attribute mass;');
        if (k > 0) out.push(`        part previous : ${name}Block${k - 1};`);
        else out.push(imported ? `        part previous : ${imported}Block0;` : '        attribute id;');
        out.push('    }');
        out.push(`    part ${name.toLowerCase()}Usage${k} : ${name}Block${k};`);
        out.push('');
    }
    out.push('}');
    return out.join('\n') + '\n';
}

/** A package of at most `maxLines` lines, and close to it. */
function generatePackageOfLines(name: string, maxLines: number, imported?: string): string {
    let lines = maxLines;
    let text = generatePackage(name, lines, imported);
    while (lineCount(text) > maxLines) text = generatePackage(name, lines -= BLOCK_LINES, imported);
    return text;
}

/** A workspace of `files` packages, each importing the one before. */
function generateWorkspace(files: number): ValidateTextDocument[] {
    return Array.from({ length: files }, (_, i) => ({
        uri: `file:///ws/p${i}.sysml`,
        text: generatePackage(`P${i}`, 22, i > 0 ? `P${i - 1}` : undefined),
    }));
}

/** A document manager holding `workspace`, with an enabled text validator over it. */
function setup(workspace: ValidateTextDocument[]) {
    const dm = new DocumentManager();
    for (const { uri, text } of workspace) {
        const errors = dm.parse(TextDocument.create(uri, 'sysml', 1, text)).errors.length;
        if (errors > 0) throw new Error(`validateText benchmark: generated ${uri} has ${errors} syntax errors`);
    }
    const semanticValidator = new SemanticValidator(dm);
    const provider = new TextValidationProvider(dm, semanticValidator);
    provider.configure({ enabled: true, maxDocuments: Number.MAX_SAFE_INTEGER, maxLines: Number.MAX_SAFE_INTEGER });
    // Validating every document once builds the caches an idle server has.
    for (const { uri } of workspace) semanticValidator.validate(uri);
    return { dm, semanticValidator, provider };
}

/** Benchmarks one `validateText` request, with its size and diagnostics count as metadata. */
function benchmarkRequest(
    name: string,
    provider: TextValidationProvider,
    documents: ValidateTextDocument[],
    opts: BenchmarkOptions,
): BenchmarkResult {
    // Syntax-valid texts, so the semantic checks run on the whole text.
    if (documents.some(d => parseDocument(d.text).errors.length > 0)) {
        throw new Error(`validateText benchmark preflight failed: ${name} has syntax errors`);
    }
    return benchmarkFn(name, () => {
        const { documents: answered } = provider.validate({ documents });
        return {
            documents: documents.length,
            lines: documents.reduce((sum, d) => sum + lineCount(d.text), 0),
            characters: documents.reduce((sum, d) => sum + d.text.length, 0),
            diagnostics: answered.reduce((sum, d) => sum + d.diagnostics.length, 0),
        };
    }, opts);
}

/** Times `measured` only, after an untimed `before`, `runs` times (plus warmup). */
function benchmarkAfter(name: string, before: () => void, measured: () => void, opts: BenchmarkOptions): BenchmarkResult {
    const runs = opts.runs ?? 5;
    for (let i = 0; i < (opts.warmup ?? 2); i++) {
        before();
        measured();
    }
    const timings: number[] = [];
    for (let i = 0; i < runs; i++) {
        before();
        const start = performance.now();
        measured();
        timings.push(performance.now() - start);
    }
    return { name, timings, stats: computeStats(timings), memoryDeltas: [] };
}

export function runValidateTextSuite(opts: BenchmarkOptions = {}): SuiteReport {
    const results: BenchmarkResult[] = [];

    // ── By workspace size: the edited content of one document (adds a definition and a usage) ──
    for (const files of [20, 100, 300]) {
        const workspace = generateWorkspace(files);
        const { provider } = setup(workspace);
        const edited = workspace[Math.floor(files / 2)];
        const text = edited.text.replace(/\}\n$/, '    part def Added;\n    part added : Added;\n}\n');
        results.push(benchmarkRequest(`workspace/${files}-files`, provider, [{ uri: edited.uri, text }], opts));
    }

    const workspace = generateWorkspace(100);
    const { semanticValidator, provider } = setup(workspace);

    // ── By text size: one new document importing the workspace ──
    for (const lines of [1_000, 5_000, 20_000]) {
        const text = generatePackage('Generated', lines, 'P99');
        results.push(benchmarkRequest(`text/${lines}-lines`, provider, [{ uri: 'file:///ws/generated.sysml', text }], opts));
    }

    // ── By document count: new documents of 200 lines each ──
    for (const count of [1, 5, 10]) {
        const documents = Array.from({ length: count }, (_, i) => ({
            uri: `file:///ws/new${i}.sysml`,
            text: generatePackage(`New${i}`, 200, 'P99'),
        }));
        results.push(benchmarkRequest(`documents/${count}x200-lines`, provider, documents, opts));
    }

    // ── The largest request the default limits accept ──
    const { maxDocuments, maxLines } = DEFAULT_TEXT_VALIDATION_SETTINGS;
    const largest = Array.from({ length: maxDocuments }, (_, i) => ({
        uri: `file:///ws/largest${i}.sysml`,
        text: generatePackageOfLines(`Largest${i}`, maxLines, 'P99'),
    }));
    results.push(benchmarkRequest('limits/defaults', provider, largest, opts));

    // ── The cost a request leaves behind: the next semantic validation of an open document ──
    const open = workspace[50];
    const edit = [{ uri: open.uri, text: open.text.replace(/\}\n$/, '    part def Added;\n}\n') }];
    results.push(benchmarkAfter('followUp/semantic-baseline', () => { }, () => semanticValidator.validate(open.uri), opts));
    results.push(benchmarkAfter('followUp/semantic-after-request', () => provider.validate({ documents: edit }),
        () => semanticValidator.validate(open.uri), opts));

    return { name: 'validateText', results };
}
