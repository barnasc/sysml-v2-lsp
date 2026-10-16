import { Diagnostic, ErrorCodes, ResponseError } from 'vscode-languageserver/node';
import { DocumentManager } from '../documentManager.js';
import { isSameDocumentUri } from '../utils/documentUri.js';
import { DiagnosticsProvider } from './diagnosticsProvider.js';
import { validateKeywords } from './keywordValidator.js';
import { SemanticValidator } from './semanticValidator.js';

/** One text to validate. */
export interface ValidateTextDocument {
    /**
     * The document the text is validated as the content of: its current
     * content is left out of the check (not changed), so the two versions
     * don't clash. Or a document that doesn't exist yet.
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
 * Settings of the experimental `sysml/validateText` request, from the
 * client's `sysml.experimental.validateText` configuration section. The
 * limits bound how long one request can keep the server busy.
 */
export interface TextValidationSettings {
    /** Whether the request is answered at all; off by default while the API is experimental. */
    enabled: boolean;
    /** Most documents one request may validate. */
    maxDocuments: number;
    /** Most lines one document's text may have (see `lineCount`). */
    maxLines: number;
    /** Most UTF-16 code units one document's text may have. */
    maxCharacters: number;
    /** Most UTF-16 code units all texts in one request may have together. */
    maxTotalCharacters: number;
}

/**
 * Off by default. Document, line and character limits bound the input,
 * including dense single-line text. Runtime also depends on the workspace
 * and model complexity; these limits do not promise a fixed response time.
 */
export const DEFAULT_TEXT_VALIDATION_SETTINGS: Readonly<TextValidationSettings> = {
    enabled: false,
    maxDocuments: 5,
    maxLines: 200,
    maxCharacters: 8_192,
    maxTotalCharacters: 16_384,
};

/**
 * The settings in `section` (the `sysml.experimental.validateText` value
 * a client returns), each missing or invalid one replaced by its default.
 */
export function readTextValidationSettings(section: unknown): TextValidationSettings {
    const raw = (typeof section === 'object' && section !== null ? section : {}) as Record<string, unknown>;
    const limit = (value: unknown, fallback: number) => (Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback);
    return {
        enabled: raw.enabled === true,
        maxDocuments: limit(raw.maxDocuments, DEFAULT_TEXT_VALIDATION_SETTINGS.maxDocuments),
        maxLines: limit(raw.maxLines, DEFAULT_TEXT_VALIDATION_SETTINGS.maxLines),
        maxCharacters: limit(raw.maxCharacters, DEFAULT_TEXT_VALIDATION_SETTINGS.maxCharacters),
        maxTotalCharacters: limit(raw.maxTotalCharacters, DEFAULT_TEXT_VALIDATION_SETTINGS.maxTotalCharacters),
    };
}

/**
 * Validates texts against the elaborated model (the workspace's documents
 * and the standard library, so references to them resolve) without
 * changing any state: no document is opened, nothing is published, and
 * every cache is as before. Experimental: disabled unless configured.
 */
export class TextValidationProvider {
    private settings: TextValidationSettings = { ...DEFAULT_TEXT_VALIDATION_SETTINGS };

    /**
     * `isReported` filters diagnostics as the server does before
     * publishing them (`sysml.validation.disabledCodes`), so a text gets
     * exactly what it would get as an open document.
     */
    constructor(
        private readonly documentManager: DocumentManager,
        private readonly semanticValidator: SemanticValidator,
        private readonly isReported: (diagnostic: Diagnostic) => boolean = () => true,
    ) { }

    /** Applies the client's settings to the requests that follow. */
    configure(settings: TextValidationSettings): void {
        this.settings = { ...settings };
    }

    /**
     * The diagnostics each text would get as an open document, with all
     * texts in place at the same time. Answers `MethodNotFound` while
     * disabled, and `InvalidParams` for malformed parameters or parameters
     * over a limit.
     */
    validate(params: ValidateTextParams): ValidateTextResult {
        if (!this.settings.enabled) {
            throw new ResponseError(ErrorCodes.MethodNotFound,
                'sysml/validateText is experimental and disabled: set sysml.experimental.validateText.enabled to true.');
        }
        const documents = this.checkDocuments((params as Partial<ValidateTextParams> | undefined)?.documents);
        const known = documents.map(document => ({ uri: this.knownSpelling(document.uri), text: document.text }));
        const diagnostics = this.documentManager.withTexts(known, () => known.map(({ uri }) => this.diagnose(uri)));
        return { documents: documents.map((document, index) => ({ uri: document.uri, diagnostics: diagnostics[index] })) };
    }

    /** `documents` checked: a non-empty array of `{ uri, text }` within the limits, each naming a different document. */
    private checkDocuments(documents: unknown): ValidateTextDocument[] {
        if (!Array.isArray(documents) || documents.length === 0) invalid('"documents" must be a non-empty array of { uri, text }.');
        const { maxDocuments, maxLines, maxCharacters, maxTotalCharacters } = this.settings;
        if (documents.length > maxDocuments) {
            invalid(`${documents.length} documents, more than the ${maxDocuments} allowed (sysml.experimental.validateText.maxDocuments).`);
        }
        const checked = documents as Partial<ValidateTextDocument>[];
        let totalCharacters = 0;
        checked.forEach((document, index) => {
            if (typeof document?.text !== 'string') invalid(`documents[${index}] needs "text", the SysML text to validate.`);
            if (document.text.length > maxCharacters) {
                invalid(`documents[${index}] has ${document.text.length} characters, more than the ${maxCharacters} allowed (sysml.experimental.validateText.maxCharacters).`);
            }
            totalCharacters += document.text.length;
            if (totalCharacters > maxTotalCharacters) {
                invalid(`${totalCharacters} total characters, more than the ${maxTotalCharacters} allowed (sysml.experimental.validateText.maxTotalCharacters).`);
            }
            const lines = lineCount(document.text);
            if (lines > maxLines) {
                invalid(`documents[${index}] has ${lines} lines, more than the ${maxLines} allowed (sysml.experimental.validateText.maxLines).`);
            }
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
        return diagnostics.filter(this.isReported);
    }

    /** The spelling under which the server knows the document `uri` names, else `uri` itself (see `isSameDocumentUri`). */
    private knownSpelling(uri: string): string {
        return this.documentManager.getUris().find(known => isSameDocumentUri(known, uri)) ?? uri;
    }
}

/** The number of lines of `text`, as an editor shows them: a final line break starts no new line, and empty text has none. */
export function lineCount(text: string): number {
    const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0;
    return text === '' || /[\r\n]$/.test(text) ? breaks : breaks + 1;
}

function isUri(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

function invalid(message: string): never {
    throw new ResponseError(ErrorCodes.InvalidParams, `sysml/validateText: ${message}`);
}
