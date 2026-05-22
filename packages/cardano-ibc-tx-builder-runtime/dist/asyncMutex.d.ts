export declare class AsyncMutex {
    private tail;
    runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}
