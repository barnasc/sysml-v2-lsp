/**
 * Result types for the `sysml/serverStats` and `sysml/clearCache` custom LSP
 * requests.
 */

/** The number of entries in each in-memory cache. */
export interface CacheCountsDTO {
    /** Documents parsed, open in the editor or scanned from the workspace. */
    documents: number;
    /**
     * Always 0: the server keeps one workspace symbol table, built
     * incrementally with the documents, and no other symbol tables.
     *
     * @deprecated since 0.40.0, to be removed in a future release.
     */
    symbolTables: number;
    /** Always 0: semantic tokens are not cached. */
    semanticTokens: number;
}

/** The result of `sysml/serverStats`: server health and memory statistics. */
export interface ServerStatsResult {
    /** Seconds since the server started. */
    uptime: number;
    /** Memory use in MB, all 0 where `process.memoryUsage` is unavailable (the browser worker). */
    memory: {
        heapUsed: number;
        heapTotal: number;
        rss: number;
        external: number;
    };
    caches: CacheCountsDTO;
}

/** The result of `sysml/clearCache`: the number of entries evicted from each cache. */
export type ClearCacheResult = CacheCountsDTO;
