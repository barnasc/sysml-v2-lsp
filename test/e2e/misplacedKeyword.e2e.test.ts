import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Diagnostic } from 'vscode-languageserver/node';

const serverPath = fileURLToPath(new URL('../../dist/server/server.js', import.meta.url));

/**
 * A misplaced keyword through the real LSP transport: every diagnostics set published for a
 * document -- the parse worker's fast one and the main thread's -- reports it as a keyword used
 * as a name only where it is one, and keeps the parser's message otherwise.
 */
it('reports a keyword as a name only where it is one, in the worker and the main-thread diagnostics', async () => {
    const rpc = await import('../../server/node_modules/vscode-jsonrpc/lib/node/main.js');
    const child = fork(serverPath, ['--node-ipc'], { silent: true });
    const connection = rpc.createMessageConnection(new rpc.IPCMessageReader(child), new rpc.IPCMessageWriter(child));
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('workspace/configuration', (params: { items: unknown[] }) => params.items.map(() => ({})));
    const published = new Map<string, Diagnostic[][]>();
    connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: Diagnostic[] }) => {
        published.set(params.uri, [...(published.get(params.uri) ?? []), params.diagnostics]);
    });
    connection.listen();
    const cases = {
        keywordName: { text: 'part def part;', asName: true },
        missingSemicolon: { text: 'part def A {\n  attribute x : Real\n  attribute y : Real;\n}', asName: false },
        successionFlowDef: { text: 'succession flow def SF;', asName: false },
    };
    try {
        await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
        await connection.sendNotification('initialized', {});
        for (const [name, { text }] of Object.entries(cases)) {
            await connection.sendNotification('textDocument/didOpen', {
                textDocument: { uri: `file:///${name}.sysml`, languageId: 'sysml', version: 1, text },
            });
        }
        // Both the worker's and the main thread's diagnostics have been published.
        const deadline = Date.now() + 10_000;
        while (Object.keys(cases).some(name => (published.get(`file:///${name}.sysml`)?.length ?? 0) < 2) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        for (const [name, { asName }] of Object.entries(cases)) {
            const sets = published.get(`file:///${name}.sysml`) ?? [];
            expect(sets.length, name).toBeGreaterThanOrEqual(2);
            for (const diagnostics of sets) {
                expect(diagnostics.some(d => Diagnostic.getMessageString(d).includes('reserved SysML keyword')), name).toBe(asName);
            }
        }
        await connection.sendRequest('shutdown');
        await connection.sendNotification('exit');
    } finally {
        connection.dispose();
        child.kill();
    }
}, 30_000);
