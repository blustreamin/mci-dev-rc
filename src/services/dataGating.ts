
export const DataGatingService = {
    async isMasterDataReady(): Promise<boolean> {
        return true; // Always allow flow in V1 Generative Mode
    }
};
