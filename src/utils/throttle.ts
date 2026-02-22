
/**
 * Creates a throttled function that only invokes `func` at most once per every `limit` milliseconds.
 */
export function createThrottle<T extends (...args: any[]) => void>(func: T, limit: number): T {
    let inThrottle: boolean;
    let lastFunc: any;
    let lastRan: number = 0;
    
    return function(this: any, ...args: any[]) {
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            lastRan = Date.now();
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function() {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    } as T;
}
