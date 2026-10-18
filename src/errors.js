/** Diagnostics contain codes and positions only, never prompt or URL contents. */
export class CompatibilityError extends Error {
    constructor(code, index = null, fields = []) {
        super(code);
        this.name = 'CompatibilityError';
        this.code = code;
        this.index = index;
        this.fields = fields;
    }
}

export function diagnostic(error) {
    return error instanceof CompatibilityError
        ? { code: error.code, index: error.index, fields: error.fields }
        : { code: 'unexpected', index: null, fields: [] };
}

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
