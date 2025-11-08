"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatErrorDetails = formatErrorDetails;
function formatErrorDetails(error) {
    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack
        };
    }
    return error;
}
//# sourceMappingURL=errors.js.map