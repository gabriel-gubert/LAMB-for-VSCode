const vscode = require('vscode');
const { runLambPythonCode } = require('./cliRunner');

let cachedSupportedLanguages = null;

const LOAD_LANGUAGES_SNIPPET = [
    'import json',
    'try:',
    '    from lamb.core.schemas import get_supported_languages',
    '    langs = get_supported_languages()',
    'except Exception:',
    '    import tree_sitter_language_pack as tslp',
    '    langs = sorted(set(tslp.manifest_languages())) if hasattr(tslp, "manifest_languages") else sorted(set(tslp.available_languages()))',
    'print(json.dumps(langs))'
].join('\n');

const DETECT_LANGUAGE_SNIPPET = [
    'import sys',
    'import tree_sitter_language_pack as tslp',
    'lang = tslp.detect_language(sys.argv[1]) if hasattr(tslp, "detect_language") else None',
    'print(lang or "")'
].join('\n');

/**
 * Loads and caches the supported Tree-sitter language identifiers from ~/.lamb/venv.
 */
async function loadSupportedLanguages(outputChannel) {
    if (Array.isArray(cachedSupportedLanguages) && cachedSupportedLanguages.length > 0) {
        return cachedSupportedLanguages;
    }

    try {
        const rawJson = await runLambPythonCode(LOAD_LANGUAGES_SNIPPET);
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
            const cleaned = parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
            if (cleaned.length > 0) {
                cachedSupportedLanguages = cleaned;
                return cachedSupportedLanguages;
            }
        }
    } catch (err) {
        if (outputChannel) {
            outputChannel.appendLine(`[LAMB] Warning: Failed to load supported languages (${err.message}). Falling back to LLM auto-detection.`);
        }
    }

    return [];
}

/**
 * Resolves the canonical Tree-sitter language identifier for a VS Code document
 * using its active languageId or tree_sitter_language_pack.detect_language(fsPath).
 */
async function detectEditorLanguage(document, supportedLanguages, outputChannel) {
    if (!document || !Array.isArray(supportedLanguages) || supportedLanguages.length === 0) {
        return null;
    }

    const supportedSet = new Set(supportedLanguages);
    const languageId = typeof document.languageId === 'string' ? document.languageId.trim().toLowerCase() : '';

    if (languageId && supportedSet.has(languageId)) {
        return languageId;
    }

    if (document.uri && document.uri.scheme === 'file' && document.uri.fsPath) {
        try {
            const detected = await runLambPythonCode(DETECT_LANGUAGE_SNIPPET, [document.uri.fsPath]);
            if (detected && supportedSet.has(detected)) {
                return detected;
            }
        } catch (err) {
            if (outputChannel) {
                outputChannel.appendLine(`[LAMB] Warning: Failed to detect file language (${err.message}).`);
            }
        }
    }

    return null;
}

/**
 * Builds VS Code QuickPick items for selecting the migration source language.
 */
function buildLanguageQuickPickItems(detectedLanguage, supportedLanguages) {
    const items = [];

    if (detectedLanguage) {
        items.push({
            label: `$(symbol-code) ${detectedLanguage}`,
            description: 'Detected from active editor',
            language: detectedLanguage
        });
    }

    items.push({
        label: '$(sparkle) Auto-detect (LLM)',
        description: 'Let LAMB detect the language automatically (omit --language)',
        language: null
    });

    const remaining = (supportedLanguages || []).filter(lang => lang !== detectedLanguage);
    if (remaining.length > 0) {
        items.push({
            label: 'Supported Tree-sitter Languages',
            kind: vscode.QuickPickItemKind.Separator
        });
        for (const lang of remaining) {
            items.push({
                label: lang,
                language: lang
            });
        }
    }

    return items;
}

module.exports = {
    loadSupportedLanguages,
    detectEditorLanguage,
    buildLanguageQuickPickItems
};
