const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const settingsToToml = require('./settingsToToml.json');

// --- Configuration & TOML Sync Helpers ---
function parsePrimitiveValue(val) {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();

    // 1. Primitive numbers and booleans return unquoted native types
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    if (trimmed !== '' && !isNaN(Number(trimmed))) return Number(trimmed);

    // 2. Complex JSON structures (objects/arrays) are validated and escaped in outer quotes
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return JSON.stringify(trimmed); // Escapes inner quotes AND adds outer double quotes
        } catch {
            // Fall through if invalid JSON
        }
    }

    // 3. Regular strings get wrapped in outer double quotes
    return `"${trimmed}"`;
}

function setDeepProperty(obj, pathStr, value) {
    const parts = pathStr.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];

        if (!current[part] || typeof current[part] !== 'object') current[part] = {};

        current = current[part];
    }
    const lastPart = parts[parts.length - 1];

    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof current[lastPart] === 'object') {
        Object.assign(current[lastPart], value);
    } else {
        current[lastPart] = value;
    }
}

function stringifyToToml(obj, currentPath = '') {
    let output = '';
    const primitives = {};
    const subsections = {};

    // 1. Separate primitive values from nested dictionaries at the current depth
    for (const [key, val] of Object.entries(obj)) {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            subsections[key] = val;
        } else {
            primitives[key] = val;
        }
    }

    // 2. Output primitive key-value pairs for the current section header
    if (Object.keys(primitives).length > 0) {
        if (currentPath) {
            output += `\n[${currentPath}]\n`;
        }
        for (const [k, v] of Object.entries(primitives)) {
            const parsed = parsePrimitiveValue(v);
            output += `${k} = ${parsed}\n`;
        }
    }

    // 3. Recurse into nested dictionaries automatically constructing TOML section paths
    for (const [subKey, subVal] of Object.entries(subsections)) {
        const cleanSubKey = subKey.replace('_agent', '');
        const nextPath = currentPath ? `${currentPath}.${cleanSubKey}` : cleanSubKey;
        output += stringifyToToml(subVal, nextPath);
    }

    return output;
}

function syncSettingsToToml() {
    const config = vscode.workspace.getConfiguration('lamb');
    const tomlData = {};

    for (const [vsCodeKey, tomlPath] of Object.entries(settingsToToml)) {
        const val = config.get(vsCodeKey);

        if (val !== undefined && val !== null && val !== '') {
            setDeepProperty(tomlData, tomlPath, val);
        }
    }

    const targetDir = path.join(os.homedir(), '.lamb');
    try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'config.toml'), stringifyToToml(tomlData), 'utf8');
    } catch (err) {
        console.error(`[X] Failed Writing Configuration: ${err.message}`);
    }
}

module.exports = {
    syncSettingsToToml,
    parsePrimitiveValue,
    setDeepProperty,
    stringifyToToml
};