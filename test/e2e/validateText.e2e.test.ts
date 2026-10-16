/**
 * End-to-end test of the experimental `sysml/validateText` against the real
 * server: enabled and limited through the client's
 * `sysml.experimental.validateText` settings, it answers right after
 * `initialized`, validates several texts together against the scanned
 * workspace and the standard library, publishes nothing, leaves an open
 * document as it was, answers malformed or over-limit parameters with
 * InvalidParams, and MethodNotFound once disabled again.
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
    /** The client's `sysml.experimental` settings, as the server pulls them. */
    const experimental = { validateText: { enabled: true, maxDocuments: 2, maxLines: 5 } };

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
        connection.onRequest('workspace/configuration', (params: { items: { section?: string }[] }) =>
            params.items.map(item => (item.section === 'sysml.experimental' ? experimental : {})));
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

    it('leaves an open document as it was: same symbols, no publishes', async () => {
        const uri = pathToFileURL(join(root, 'parts.sysml')).href;
        await connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: 'sysml', version: 1, text: 'package Parts { part def Engine; }\n' },
        });
        await quiet(500);
        const symbols = () => connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } });
        const before = await symbols();
        const publishedBefore = published.length;

        const result = await validate([{ uri, text: 'package Parts { part def Temporary; }\n' }]);
        // Checked in place of the open document's content: no clash with its own version.
        expect(codes(result)[0]).not.toContain('ambiguous-namespace-name');

        expect(await symbols()).toEqual(before);
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(published.slice(publishedBefore)).toEqual([]);
    });

    it('answers requests over the configured limits with InvalidParams, naming the setting', async () => {
        const at = (name: string) => pathToFileURL(join(root, name)).href;
        await expect(validate([
            { uri: at('a.sysml'), text: '' }, { uri: at('b.sysml'), text: '' }, { uri: at('c.sysml'), text: '' },
        ])).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('sysml.experimental.validateText.maxDocuments') });
        await expect(validate([{ uri: at('a.sysml'), text: 'package A {\n\n\n\n\n}\n' }]))
            .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('sysml.experimental.validateText.maxLines') });
    });

    it('answers malformed parameters with InvalidParams (-32602)', async () => {
        await expect(connection.sendRequest('sysml/validateText', { documents: [] })).rejects.toMatchObject({ code: -32602 });
        await expect(connection.sendRequest('sysml/validateText', { documents: [{ text: 'package A;' }] })).rejects.toMatchObject({
            code: -32602,
            message: expect.stringContaining('documents[0] needs "uri"'),
        });
    });

    it('answers MethodNotFound (-32601) once the client disables it', async () => {
        experimental.validateText.enabled = false;
        await connection.sendNotification('workspace/didChangeConfiguration', { settings: {} });
        const request = () => validate([{ uri: pathToFileURL(join(root, 'a.sysml')).href, text: 'package A;' }]);
        // The server pulls the settings after the notification; wait until it has.
        const deadline = Date.now() + 5_000;
        let error: unknown;
        while (Date.now() < deadline) {
            error = await request().then(() => undefined, (e: unknown) => e);
            if (error) break;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        expect(error).toMatchObject({ code: -32601, message: expect.stringContaining('sysml.experimental.validateText.enabled') });
    });
});

describe('sysml/validateText not enabled by the client (real server)', () => {
    /**
     * Starts a server whose client answers `sysml.experimental` with
     * `experimental` (or doesn't support `workspace/configuration` at all),
     * and resolves once it is initialized.
     */
    async function start(experimental: unknown, configuration = true) {
        const rpc = await import('../../server/node_modules/vscode-jsonrpc/lib/node/main.js');
        const server = fork(serverPath, ['--node-ipc'], { silent: true });
        const connection = rpc.createMessageConnection(new rpc.IPCMessageReader(server), new rpc.IPCMessageWriter(server));
        connection.onRequest('client/registerCapability', () => null);
        connection.onRequest('workspace/configuration', (params: { items: { section?: string }[] }) =>
            params.items.map(item => (item.section === 'sysml.experimental' ? experimental : null)));
        connection.listen();
        await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: { workspace: { configuration } } });
        await connection.sendNotification('initialized', {});
        const stop = async () => {
            await connection.sendRequest('shutdown');
            connection.sendNotification('exit');
            server.kill();
        };
        return { connection, stop };
    }

    it.each([
        ['no sysml.experimental settings', null, true],
        ['an empty validateText section', { validateText: {} }, true],
        ['enabled: false', { validateText: { enabled: false, maxDocuments: 5, maxLines: 200 } }, true],
        ['a client without workspace/configuration', { validateText: { enabled: true } }, false],
    ])('answers MethodNotFound (-32601) with %s', async (_case, experimental, configuration) => {
        const { connection, stop } = await start(experimental, configuration);
        try {
            await expect(connection.sendRequest('sysml/validateText', { documents: [{ uri: 'file:///ws/a.sysml', text: 'package A;' }] }))
                .rejects.toMatchObject({ code: -32601, message: expect.stringContaining('sysml.experimental.validateText.enabled') });
        } finally {
            await stop();
        }
    });
});
