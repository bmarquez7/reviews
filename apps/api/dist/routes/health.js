export const healthRoutes = async (app) => {
    app.get('/health', async () => ({ data: { ok: true } }));
};
