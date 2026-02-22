
export class CancelToken {
    isCancelled = false;
    reason = '';
    
    cancel(reason: string = 'Cancelled') {
        this.isCancelled = true;
        this.reason = reason;
    }
    
    throwIfCancelled() {
        if (this.isCancelled) {
            throw new Error(`CANCELLED: ${this.reason}`);
        }
    }
}
