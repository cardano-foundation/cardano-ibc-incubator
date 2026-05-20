"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncMutex = void 0;
class AsyncMutex {
    tail = Promise.resolve();
    async runExclusive(operation) {
        let release;
        const previous = this.tail;
        this.tail = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
}
exports.AsyncMutex = AsyncMutex;
