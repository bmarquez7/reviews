const SUPPORTED = ['en', 'es', 'fr', 'sq', 'el', 'it'];
export const i18nRoutes = async (app) => {
    app.get('/i18n/languages', async () => ({
        data: {
            supported: SUPPORTED,
            fallback: 'en',
            extendable: true
        }
    }));
};
