import { CommonTokenStream, Token } from 'antlr4ng';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { DocumentManager } from '../documentManager.js';
import { SyntaxError } from '../parser/errorListener.js';
import { keywordAsNameMessage } from '../parser/keywordAsName.js';

/**
 * Provides diagnostics (errors/warnings) for SysML documents.
 * Converts ANTLR parse errors into LSP Diagnostic objects.
 */
export class DiagnosticsProvider {
    constructor(private documentManager: DocumentManager) { }

    /**
     * Get diagnostics for a parsed document.
     */
    getDiagnostics(uri: string): Diagnostic[] {
        const result = this.documentManager.get(uri);
        if (!result) {
            return [];
        }

        return result.errors.map(error => this.syntaxErrorToDiagnostic(error, result.tokenStream));
    }

    private syntaxErrorToDiagnostic(error: SyntaxError, tokenStream: CommonTokenStream): Diagnostic {
        // A reserved keyword used as a name gets a clear message; any other
        // misplaced keyword keeps the parser's own message.
        const token = error.offendingSymbol;
        const message = (token && keywordAsNameMessage(
            this.visibleNeighbour(tokenStream, token.tokenIndex, -1),
            token,
            this.visibleNeighbour(tokenStream, token.tokenIndex, 1),
        )) ?? error.message;

        return {
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: error.line, character: error.column },
                end: { line: error.line, character: error.column + error.length },
            },
            message,
            source: 'sysml',
        };
    }

    /** The nearest default-channel token before (`step` -1) or after (`step` 1) `index`. */
    private visibleNeighbour(tokenStream: CommonTokenStream, index: number, step: -1 | 1): Token | undefined {
        const tokens = tokenStream.getTokens();
        for (let i = index + step; i >= 0 && i < tokens.length; i += step) {
            if (tokens[i].channel === Token.DEFAULT_CHANNEL) return tokens[i];
        }
        return undefined;
    }
}
