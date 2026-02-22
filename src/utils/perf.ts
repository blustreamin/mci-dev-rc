
const markers = new Map<string, number>();

export const Perf = {
    start(label: string) {
        markers.set(label, performance.now());
    },
    end(label: string) {
        const start = markers.get(label);
        if (start) {
            const duration = performance.now() - start;
            // console.debug(`[PERF] ${label}: ${duration.toFixed(2)}ms`);
            markers.delete(label);
            return duration;
        }
        return 0;
    }
};
