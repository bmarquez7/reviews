export class ApiError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
export const toErrorResponse = (error) => {
    if (error instanceof ApiError) {
        return {
            statusCode: error.statusCode,
            body: {
                error: {
                    code: error.code,
                    message: error.message,
                    details: error.details ?? null
                }
            }
        };
    }
    return {
        statusCode: 500,
        body: {
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Unexpected server error',
                details: null
            }
        }
    };
};
