/**
 * End-to-end test of `sysml/validateText` against the real server: the
 * request is registered, answers right after `initialized`, validates several texts
 * together against the scanned workspace and the standard library, publishes
 * nothing, and answers malformed parameters with JSON-RPC's InvalidParams.
 *
 * Requires `dist/server/server.js` -- `npm run test:e2e` builds it first.
 */
import { fork } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Diagnostic = { code?: string; message: string };
type ValidateTextResult = { documents: { uri: string; diagnostics: Diagnostic[] }[] };

const serverPath = fileURLToPath(new URL('../../dist/server/server.js', import.meta.url));

const codes = (result: ValidateTextResult) => result.documents.map(d => d.diagnostics.map(diagnostic => diagnostic.code));

describe('sysml/validateText (real server)', () => {
    let root: string;
    let child: ReturnType<typeof fork>;
    let connection: Awaited<ReturnType<typeof connect>>['connection'];
    let published: string[];
    let scanDone: Promise<void>;
    /** The result of a request sent right after `initialized`, before anything else. */
    let early: Promise<ValidateTextResult>;

    /** Starts the server over IPC and records every published diagnostics uri. */
    async function connect() {
        const rpc = await import('../../server/node_modules/vscode-jsonrpc/lib/node/main.js');
        const server = fork(serverPath, ['--node-ipc'], { silent: true });
        const rpcConnection = rpc.createMessageConnection(new rpc.IPCMessageReader(server), new rpc.IPCMessageWriter(server));
        return { server, connection: rpcConnection };
    }

    /** Resolves once no diagnostics have been published for `ms` (at most 10 s). */
    async function quiet(ms: number): Promise<void> {
        const deadline = Date.now() + 10_000;
        let seen = published.length;
        let since = Date.now();
        while (Date.now() - since < ms && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (published.length !== seen) {
                seen = published.length;
                since = Date.now();
            }
        }
    }

    const validate = (documents: { uri: string; text: string }[]) =>
        connection.sendRequest('sysml/validateText', { documents }) as Promise<ValidateTextResult>;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), 'validate-text-'));
        await writeFile(join(root, 'parts.sysml'), 'package Parts { part def Engine; }\n');

        const started = await connect();
        child = started.server;
        connection = started.connection;
        connection.onRequest('client/registerCapability', () => null);
        connection.onRequest('workspace/configuration', () => [{}]);
        let scanned!: () => void;
        scanDone = new Promise<void>(resolve => { scanned = resolve; });
        connection.onNotification('window/logMessage', (params: { message: string }) => {
            if (params.message.startsWith('Workspace scan:')) scanned();
        });
        published = [];
        connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string }) => published.push(params.uri));
        connection.listen();

        const folder = pathToFileURL(root).href;
        await connection.sendRequest('initialize', {
            processId: process.pid,
            rootUri: folder,
            workspaceFolders: [{ uri: folder, name: 'ws' }],
            capabilities: { workspace: { workspaceFolders: true, configuration: true } },
            initializationOptions: { isWorkspaceFile: true },
        });
        await connection.sendNotification('initialized', {});
        // Sent before waiting for anything else, as a client may right after `initialized`.
        early = validate([{ uri: pathToFileURL(join(root, 'mass.sysml')).href, text: 'package Mass { private import ScalarValues::*; attribute mass : Real; }' }]);
        await scanDone;
    });

    afterAll(async () => {
        await connection.sendRequest('shutdown');
        connection.sendNotification('exit');
        child.kill();
        await rm(root, { recursive: true, force: true });
    });

    it('answers a request sent right after `initialized`, with standard library types resolved', async () => {
        expect(codes(await early)).toEqual([expect.not.arrayContaining(['unresolved-type'])]);
    });

    it('validates several texts together against the scanned workspace, publishing nothing', async () => {
        const motors = pathToFileURL(join(root, 'motors.sysml')).href;
        const drive = pathToFileURL(join(root, 'drive.sysml')).href;
        // Let any late publish from the workspace scan pass first, so only the request's own would count.
        await quiet(500);
        const publishedBefore = published.length;

        const result = await validate([
            { uri: motors, text: 'package Motors { private import Parts::*; part def Motor { part engine : Engine; } }' },
            { uri: drive, text: 'package Drive { private import Motors::*; part motor : Motor; part gearbox : Gearbox; }' },
        ]);

        expect(result.documents.map(d => d.uri)).toEqual([motors, drive]);
        expect(codes(result)[0]).not.toContain('unresolved-type');
        expect(result.documents[1].diagnostics.filter(d => d.code === 'unresolved-type').map(d => d.message)).toEqual([
            expect.stringContaining('Gearbox'),
        ]);
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(published.slice(publishedBefore)).toEqual([]);
    });

    it('answers malformed parameters with InvalidParams (-32602)', async () => {
        await expect(connection.sendRequest('sysml/validateText', { documents: [] })).rejects.toMatchObject({ code: -32602 });
        await expect(connection.sendRequest('sysml/validateText', { documents: [{ text: 'package A;' }] })).rejects.toMatchObject({
            code: -32602,
            message: expect.stringContaining('documents[0] needs "uri"'),
        });
    });
});
