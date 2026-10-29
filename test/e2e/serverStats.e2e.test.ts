import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { ClearCacheResult, ServerStatsResult } from '../../server/src/serverStatsTypes.js';

const serverPath = fileURLToPath(new URL('../../dist/server/server.js', import.meta.url));

it('reports and clears its caches, with the deprecated symbol table count at 0', async () => {
    const rpc = await import('../../server/node_modules/vscode-jsonrpc/lib/node/main.js');
    const child = fork(serverPath, ['--node-ipc'], { silent: true });
    const connection = rpc.createMessageConnection(new rpc.IPCMessageReader(child), new rpc.IPCMessageWriter(child));
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('workspace/configuration', (params: { items: unknown[] }) => params.items.map(() => ({})));
    connection.listen();
    try {
        await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
        await connection.sendNotification('initialized', {});
        const uri = 'file:///server-stats-e2e.sysml';
        await connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: 'sysml', version: 1, text: 'package P { part def A; }' },
        });
        // Answered once the document is parsed.
        await connection.sendRequest('sysml/model', { textDocument: { uri }, scope: ['elements'] });

        const stats = await connection.sendRequest<ServerStatsResult>('sysml/serverStats');
        expect(stats.caches).toEqual({ documents: 1, symbolTables: 0, semanticTokens: 0 });
        expect(stats.uptime).toBeGreaterThanOrEqual(0);
        expect(stats.memory.heapUsed).toBeGreaterThan(0);

        const cleared = await connection.sendRequest<ClearCacheResult>('sysml/clearCache');
        expect(cleared).toEqual({ documents: 1, symbolTables: 0, semanticTokens: 0 });
        expect((await connection.sendRequest<ServerStatsResult>('sysml/serverStats')).caches.documents).toBe(0);
        await connection.sendRequest('shutdown');
        await connection.sendNotification('exit');
    } finally {
        connection.dispose();
        child.kill();
    }
});
