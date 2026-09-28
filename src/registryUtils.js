const fs = require('fs');
const path = require('path');
const os = require('os');

function loadMappingAliases() {
    const registryPath = path.join(os.homedir(), '.lamb', 'registry.json');
    if (!fs.existsSync(registryPath)) return [];
    try {
        return Object.keys(JSON.parse(fs.readFileSync(registryPath, 'utf8')));
    } catch {
        return [];
    }
}

module.exports = {
    loadMappingAliases
};