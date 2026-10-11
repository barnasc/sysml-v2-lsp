import { Diagnostic, ErrorCodes, ResponseError } from 'vscode-languageserver/node';
import { DocumentManager } from '../documentManager.js';
import { isSameDocumentUri } from '../utils/documentUri.js';
import { DiagnosticsProvider } from './diagnosticsProvider.js';
import { validateKeywords } from './keywordValidator.js';
import { SemanticValidator } from './semanticValidator.js';

/** One text to validate. */
export interface ValidateTextDocument {
    /**
     * The document the text is the new content of, so its current content
     * is left out and the two versions don't clash; or a new document.
     */
    uri: string;
    /** The SysML or KerML text. */
    text: string;
}

/** `sysml/validateText` parameters: one or more texts, validated together (references between them resolve). */
export interface ValidateTextParams {
    documents: ValidateTextDocument[];
}

/** `sysml/validateText` result: each document's diagnostics, in request order. */
export interface ValidateTextResult {
    documents: { uri: string; diagnostics: Diagnostic[] }[];
}

/**
 * Validates texts against the whole workspace (references to other files
 * and the standard library resolve) without changing any state: no
 * document is opened, nothing is published, and every cache is as before.
 */
export class TextValidationProvider {
    constructor(
        private readonly documentManager: DocumentManager,
        private readonly semanticValidator: SemanticValidator,
    ) { }

    /**
     * The diagnostics each text would get as an open document, with all
     * texts in place at the same time. Answers `InvalidParams` for
     * malformed parameters.
     */
    validate(params: ValidateTextParams): ValidateTextResult {
        const documents = this.checkDocuments((params as Partial<ValidateTextParams> | undefined)?.documents);
        const known = documents.map(document => ({ uri: this.knownSpelling(document.uri), text: document.text }));
        const diagnostics = this.documentManager.withTexts(known, () => known.map(({ uri }) => this.diagnose(uri)));
        return { documents: documents.map((document, index) => ({ uri: document.uri, diagnostics: diagnostics[index] })) };
    }

    /** `documents` checked: a non-empty array of `{ uri, text }`, each naming a different document. */
    private checkDocuments(documents: unknown): ValidateTextDocument[] {
        if (!Array.isArray(documents) || documents.length === 0) invalid('"documents" must be a non-empty array of { uri, text }.');
        const checked = documents as Partial<ValidateTextDocument>[];
        checked.forEach((document, index) => {
            if (typeof document?.text !== 'string') invalid(`documents[${index}] needs "text", the SysML text to validate.`);
            if (!isUri(document.uri)) invalid(`documents[${index}] needs "uri", the document the text is the content of.`);
            const earlier = checked.findIndex(other => isSameDocumentUri(other.uri as string, document.uri as string));
            if (earlier !== index) invalid(`documents[${earlier}] and documents[${index}] name the same document.`);
        });
        return checked as ValidateTextDocument[];
    }

    /** The syntax, keyword and semantic diagnostics of the document at `uri`, as published for an open document. */
    private diagnose(uri: string): Diagnostic[] {
        // A fresh provider, so its per-URI cache never holds a stand-in.
        const diagnostics = new DiagnosticsProvider(this.documentManager).getDiagnostics(uri);
        const parseResult = this.documentManager.get(uri);
        if (parseResult) diagnostics.push(...validateKeywords(parseResult));
        diagnostics.push(...this.semanticValidator.validate(uri));
        return diagnostics;
    }

    /** The spelling under which the server knows the document `uri` names, else `uri` itself (see `isSameDocumentUri`). */
    private knownSpelling(uri: string): string {
        return this.documentManager.getUris().find(known => isSameDocumentUri(known, uri)) ?? uri;
    }
}

function isUri(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

function invalid(message: string): never {
    throw new ResponseError(ErrorCodes.InvalidParams, `sysml/validateText: ${message}`);
}
