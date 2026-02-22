
import React from 'react';

/**
 * safely converts any value to a string suitable for rendering.
 * Prevents [object Object] rendering crash.
 */
export function safeText(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    
    try {
        if (Array.isArray(value)) return `[Array(${value.length})]`;
        if (typeof value === 'object') {
            // Check for common error object
            if (value.message) return value.message;
            // Fallback to JSON snippet
            const json = JSON.stringify(value);
            return json.length > 50 ? json.substring(0, 50) + '...' : json;
        }
    } catch {
        return '[Complex Object]';
    }
    return String(value);
}

/**
 * Returns a React node safely wrapping the content.
 */
export function safeNode(value: any): React.ReactNode {
    return React.createElement('span', {}, safeText(value));
}
