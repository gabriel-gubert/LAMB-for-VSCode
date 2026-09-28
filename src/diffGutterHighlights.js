const vscode = require('vscode');

const COLOR_HIGH = 'rgba(40, 167, 69, 0.85)';
const COLOR_MED  = 'rgba(255, 193, 7, 0.85)';
const COLOR_LOW  = 'rgba(220, 53, 69, 0.85)';

const decHigh = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: COLOR_HIGH,
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    gutterIconPath: createSvgDataUri(COLOR_HIGH),
    gutterIconSize: 'contain'
});

const decMed = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: COLOR_MED,
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    gutterIconPath: createSvgDataUri(COLOR_MED),
    gutterIconSize: 'contain'
});

const decLow = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: COLOR_LOW,
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    gutterIconPath: createSvgDataUri(COLOR_LOW),
    gutterIconSize: 'contain'
});

function createSvgDataUri(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="24"><rect width="4" height="24" fill="${color}" rx="2"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function renderRuleBlock(ruleScore) {
    let block = `## Rule #${ruleScore.rule_id}\n\n`;

    if (ruleScore.description) {
        const formattedDesc = ruleScore.description
            .trim()
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n');

        block += `### Rule Description\n` +
            `${formattedDesc}\n\n`;
    }

    block += `### Score & Detail\n\n` +
        `| **Property** | **Value** |\n` +
        `| :--- | :--- |\n` +
        `| **Confidence** | **${(ruleScore.score * 100).toFixed(1)}%** (\`${ruleScore.level}\`) |\n` +
        `| **Status** | \`${ruleScore.status || '<EMPTY>'}\` |\n` +
        `| **Reason(s)** | \`${ruleScore.reason || '<EMPTY>'}\` |\n` +
        `| **Operation(s)** | \`${ruleScore.operations || '<EMPTY>'}\` |\n\n`;

    if (ruleScore.input_snippet || ruleScore.output_snippet) {
        block += `---\n### Source Code Snippet(s)\n\n`;
        if (ruleScore.input_snippet) {
            block += `**Input Snippet**\n\`\`\`\n${ruleScore.input_snippet}\n\`\`\`\n\n`;
        }
        if (ruleScore.output_snippet) {
            block += `**Output Snippet**\n\`\`\`\n${ruleScore.output_snippet}\n\`\`\`\n\n`;
        }
    }

    if (ruleScore.diagnostics) {
        const diag = ruleScore.diagnostics;
        block += `---\n### Diagnostics\n\n` +
            `* **Coverage Ratio:** \`${((diag.schema_coverage_ratio || 0) * 100).toFixed(1)}%\`\n` +
            `* **Snippet Logprob Mass:** \`${((diag.snippet_logprob_mass || 0) * 100).toFixed(1)}%\` *(${diag.tokens_in_snippet || 0} tokens)*\n`;

        if (diag.matched_target_symbols && diag.matched_target_symbols.length > 0) {
            block += `* **Matched Targets:** ${diag.matched_target_symbols.map(s => `\`${s}\``).join(' ')}\n`;
        }
        if (diag.leftover_legacy_symbols && diag.leftover_legacy_symbols.length > 0) {
            block += `* **Leftover Legacy:** ${diag.leftover_legacy_symbols.map(s => `\`${s}\``).join(' ')}\n`;
        }
    }

    return block;
}

/**
 * Applies confidence score gutter indicators for applied rule snippets to the diff editor.
 * @param {vscode.TextEditor} editor Target editor in diff view
 * @param {Array} ruleScores Array of RuleConfidenceScore objects from confidence report
 */
function applyDiffConfidenceGutter(editor, ruleScores) {
    if (!editor || !ruleScores || !Array.isArray(ruleScores)) return;

    const groupedRules = new Map();

    for (const ruleScore of ruleScores) {
        let startLine = 0;
        let startChar = 0;
        let endLine = 0;
        let endChar = Number.MAX_SAFE_INTEGER;

        if (ruleScore.range && typeof ruleScore.range === 'object') {
            startLine = Math.max(0, (ruleScore.range.start_line || 1) - 1);
            startChar = Math.max(0, ruleScore.range.start_column || 0);
            endLine = Math.max(startLine, (ruleScore.range.end_line || (startLine + 1)) - 1);
            
            const rawEndChar = ruleScore.range.end_column !== undefined ? ruleScore.range.end_column : Number.MAX_SAFE_INTEGER;
            endChar = (startLine === endLine && startChar === rawEndChar) ? startChar + 1 : rawEndChar;
        } else if (ruleScore.lines && typeof ruleScore.lines === 'string') {
            const [sLine, eLine] = ruleScore.lines.split('-').map(n => parseInt(n, 10) - 1);
            if (isNaN(sLine)) continue;
            startLine = sLine;
            endLine = isNaN(eLine) ? startLine : eLine;
        } else {
            continue;
        }

        const rangeKey = `${startLine}:${startChar}-${endLine}:${endChar}`;
        if (!groupedRules.has(rangeKey)) {
            groupedRules.set(rangeKey, {
                range: new vscode.Range(
                    new vscode.Position(startLine, startChar),
                    new vscode.Position(endLine, endChar)
                ),
                rules: []
            });
        }
        groupedRules.get(rangeKey).rules.push(ruleScore);
    }

    const highRanges = [];
    const medRanges = [];
    const lowRanges = [];

    for (const { range, rules } of groupedRules.values()) {
        let hoverContent = '';

        rules.forEach((ruleScore, idx) => {
            hoverContent += renderRuleBlock(ruleScore);
            if (idx < rules.length - 1) {
                hoverContent += `\n---\n\n`;
            }
        });

        const hoverText = new vscode.MarkdownString(hoverContent);
        hoverText.isTrusted = true;
        hoverText.supportHtml = true;

        const decorationOptions = { range, hoverMessage: hoverText };

        const maxScore = Math.max(...rules.map(r => r.score || 0));
        if (maxScore >= 0.85) {
            highRanges.push(decorationOptions);
        } else if (maxScore >= 0.60) {
            medRanges.push(decorationOptions);
        } else {
            lowRanges.push(decorationOptions);
        }
    }

    editor.setDecorations(decHigh, highRanges);
    editor.setDecorations(decMed, medRanges);
    editor.setDecorations(decLow, lowRanges);
}

module.exports = { applyDiffConfidenceGutter };