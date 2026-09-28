const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MapPanelProvider = require('./mapPanelProvider');
const HighlightCodeLensProvider = require('./highlightCodeLensProvider');
const { syncSettingsToToml } = require('./configSync');
const { ensureLambPythonEnv, runLambCli } = require('./cliRunner');
const { updateEditorVisualHighlights } = require('./editorHighlights');
const { loadMappingAliases } = require('./registryUtils');
const { applyDiffConfidenceGutter } = require('./diffGutterHighlights');

// --- VSCode Output Channel ---
const outputChannel = vscode.window.createOutputChannel('LAMB Output');

// Global holder for active migration preview state
let activeMigrationSession = null;

// Helper to clean up active migration diff state
async function cleanupMigrationSession() {
    await vscode.commands.executeCommand('setContext', 'lambMigrationActive', false);
    if (activeMigrationSession && activeMigrationSession.tempFilePath && fs.existsSync(activeMigrationSession.tempFilePath)) {
        try {
            fs.unlinkSync(activeMigrationSession.tempFilePath);
        } catch (e) {
            console.error("Failed to delete temp file:", e);
        }
    }
    activeMigrationSession = null;
}

// --- Extension Activation ---
async function activate(context) {
    context.subscriptions.push(outputChannel);
    const workspaceState = context.workspaceState;

    try {
        await ensureLambPythonEnv(context.extensionPath);
    } catch (err) {
        console.error("LAMB Python Setup Failed:", err);
    }

    syncSettingsToToml();
    
    const provider = new MapPanelProvider(context.extensionUri, outputChannel, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('lamb-toolsuite.mapView', provider)
    );

    // --- Register CodeLens Provider for Inline Delete Buttons ---
    const codeLensProvider = new HighlightCodeLensProvider(workspaceState);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
    );

    if (vscode.window.activeTextEditor) {
        updateEditorVisualHighlights(vscode.window.activeTextEditor, workspaceState);
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('lamb')) syncSettingsToToml(); }),
        vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) updateEditorVisualHighlights(editor, workspaceState); }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && event.document === activeEditor.document) {
                workspaceState.update(`lamb.highlights.${event.document.uri.toString()}`, undefined);
                updateEditorVisualHighlights(activeEditor, workspaceState);
                codeLensProvider.refresh();
            }
        })
    );

    // --- Commands ---
    context.subscriptions.push(
        // Command triggered directly by clicking the inline CodeLens action
        vscode.commands.registerCommand('lamb-toolsuite.deleteHighlightByIndex', async (uri, targetIndex) => {
            const uriStr = uri.toString();
            const records = workspaceState.get(`lamb.highlights.${uriStr}`) || [];

            if (targetIndex >= 0 && targetIndex < records.length) {
                records.splice(targetIndex, 1);
                await workspaceState.update(`lamb.highlights.${uriStr}`, records.length > 0 ? records : undefined);

                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor.document.uri.toString() === uriStr) {
                    updateEditorVisualHighlights(activeEditor, workspaceState);
                }
                codeLensProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('lamb-toolsuite.addHighlight', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) return;
            const severityChoice = await vscode.window.showQuickPick([
                { label: '🔴 Red (Critical Severity / Highest Priority)', severity: 'critical' },
                { label: '🟡 Yellow (Warning Severity / Medium Priority)', severity: 'warning' },
                { label: '🟢 Green (Info Focus  / Above-Normal Priority)', severity: 'info' },
                { label: '🧊 Blue (Don\'t Touch)', severity: 'dontTouch' }
            ], { placeHolder: 'Save Persistent Severity Highlight onto Current Selection' });
            if (!severityChoice) return;

            const uriStr = editor.document.uri.toString();
            const records = workspaceState.get(`lamb.highlights.${uriStr}`) || [];
            records.push({
                startLine: editor.selection.start.line, startChar: editor.selection.start.character,
                endLine: editor.selection.end.line, endChar: editor.selection.end.character,
                severity: severityChoice.severity, code: editor.document.getText(editor.selection)
            });
            await workspaceState.update(`lamb.highlights.${uriStr}`, records);
            updateEditorVisualHighlights(editor, workspaceState);
            codeLensProvider.refresh();
        }),

        vscode.commands.registerCommand('lamb-toolsuite.clearHighlights', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            await workspaceState.update(`lamb.highlights.${editor.document.uri.toString()}`, undefined);
            updateEditorVisualHighlights(editor, workspaceState);
            codeLensProvider.refresh();
        }),

        // --- Checkmark Button Handler: Accept Changes ---
        vscode.commands.registerCommand('lamb-toolsuite.acceptMigration', async () => {
            if (!activeMigrationSession) return;
            const { originalFileUri, finalMigratedCode, editor } = activeMigrationSession;

            try {
                fs.writeFileSync(originalFileUri.fsPath, finalMigratedCode, 'utf8');
                await workspaceState.update(`lamb.highlights.${originalFileUri.toString()}`, undefined);
                if (editor) updateEditorVisualHighlights(editor, workspaceState);
                codeLensProvider.refresh();
                vscode.window.showInformationMessage('Accepted and applied LAMB migration changes.');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to apply changes: ${err.message}`);
            } finally {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await cleanupMigrationSession();
            }
        }),

        // --- X Button Handler: Discard Changes ---
        vscode.commands.registerCommand('lamb-toolsuite.discardMigration', async () => {
            if (!activeMigrationSession) return;
            vscode.window.showInformationMessage('Discarded LAMB migration changes.');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupMigrationSession();
        }),

        vscode.commands.registerCommand('lamb-toolsuite.migrate', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No Active Source File.');
                return;
            }

            const recognizedAliases = loadMappingAliases();
            if (recognizedAliases.length === 0) {
                vscode.window.showErrorMessage('No Mapping Table(s).');
                return;
            }

            const selectedAlias = await vscode.window.showQuickPick(recognizedAliases, { placeHolder: 'Select a Mapping Table' });
            if (!selectedAlias) return;

            const config = vscode.workspace.getConfiguration('lamb');
            const defaultThreshold = config.get('tasks.migration.summarizationThreshold', 2000);
            const currentVerbose = config.get('general.verbose', false);

            const currentSelection = editor.selection;
            const fullSourceCode = editor.document.getText();
            let sourceCodeToMigrate = fullSourceCode;
            let migrationScope = 'full_file';
            let selectionStartOffset = 0;
            let selectionEndOffset = 0;
            let selectionStartLine = 0;

            if (currentSelection && !currentSelection.isEmpty) {
                const scopeChoice = await vscode.window.showQuickPick([
                    { label: '📦 Migrate Selected Snippet Only', value: 'selection' },
                    { label: '🌐 Migrate Full File (With Multi-Highlight Awareness)', value: 'full_file' }
                ], { placeHolder: 'Migration Scope' });
                if (!scopeChoice) return;
                
                migrationScope = scopeChoice.value;
                if (migrationScope === 'selection') {
                    sourceCodeToMigrate = editor.document.getText(currentSelection);
                    selectionStartOffset = editor.document.offsetAt(currentSelection.start);
                    selectionEndOffset = editor.document.offsetAt(currentSelection.end);
                    selectionStartLine = currentSelection.start.line;
                }
            }

            const developerComments = await vscode.window.showInputBox({ prompt: `Additional Comments/Instructions` });
            if (developerComments === undefined) return;

            // Generate temporary report JSON path for isolated sidecar IPC
            const reportRandomId = crypto.randomBytes(4).toString('hex');
            const tempReportPath = path.join(os.tmpdir(), `lamb_report_${reportRandomId}.json`);

            const cliArgs = [
                'migrate',
                '--alias', selectedAlias,
                '--summarization-threshold', defaultThreshold.toString(),
                '--report', tempReportPath
            ];
            if (currentVerbose) cliArgs.push('--verbose');

            // --- Extract, Filter, Truncate, and Re-index Highlights ---
            const savedRecords = workspaceState.get(`lamb.highlights.${editor.document.uri.toString()}`) || [];
            let targetRecords = savedRecords;

            if (currentSelection && !currentSelection.isEmpty && migrationScope === 'selection') {
                const selStartLine = currentSelection.start.line;
                const selStartChar = currentSelection.start.character;
                const selEndLine = currentSelection.end.line;
                const selEndChar = currentSelection.end.character;

                targetRecords = savedRecords.filter(h => {
                    const startsBeforeSelEnd = h.startLine < selEndLine || (h.startLine === selEndLine && h.startChar < selEndChar);
                    const endsAfterSelStart = h.endLine > selStartLine || (h.endLine === selStartLine && h.endChar > selStartChar);
                    return startsBeforeSelEnd && endsAfterSelStart;
                }).map(h => {
                    let clampedStartLine = h.startLine;
                    let clampedStartChar = h.startChar;
                    if (h.startLine < selStartLine || (h.startLine === selStartLine && h.startChar < selStartChar)) {
                        clampedStartLine = selStartLine;
                        clampedStartChar = selStartChar;
                    }

                    let clampedEndLine = h.endLine;
                    let clampedEndChar = h.endChar;
                    if (h.endLine > selEndLine || (h.endLine === selEndLine && h.endChar > selEndChar)) {
                        clampedEndLine = selEndLine;
                        clampedEndChar = selEndChar;
                    }

                    const relStartLine = clampedStartLine - selStartLine;
                    const relEndLine = clampedEndLine - selStartLine;

                    const relStartChar = (clampedStartLine === selStartLine) ? (clampedStartChar - selStartChar) : clampedStartChar;
                    const relEndChar = (clampedEndLine === selStartLine) ? (clampedEndChar - selStartChar) : clampedEndChar;

                    return {
                        ...h,
                        startLine: relStartLine,
                        startChar: relStartChar,
                        endLine: relEndLine,
                        endChar: relEndChar
                    };
                });
            }

            // Format into 1-indexed L:C-L:C CLI range strings
            const formatRange = (h) => `${h.startLine + 1}:${h.startChar + 1}-${h.endLine + 1}:${h.endChar + 1}`;

            const criticalRanges = targetRecords.filter(r => r.severity === 'critical').map(formatRange);
            const warningRanges = targetRecords.filter(r => r.severity === 'warning').map(formatRange);
            const infoRanges = targetRecords.filter(r => r.severity === 'info').map(formatRange);
            const dontTouchRanges = targetRecords.filter(r => r.severity === 'dontTouch' || r.severity === 'dont_touch').map(formatRange);

            if (criticalRanges.length > 0) cliArgs.push('--critical', ...criticalRanges);
            if (warningRanges.length > 0) cliArgs.push('--warning', ...warningRanges);
            if (infoRanges.length > 0) cliArgs.push('--info', ...infoRanges);
            if (dontTouchRanges.length > 0) cliArgs.push('--dont-touch', ...dontTouchRanges);

            if (developerComments && developerComments.trim().length > 0) {
                cliArgs.push('--user-comments', developerComments.trim());
            }

            outputChannel.show(true);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Running LAMB Processing Suite...`,
                cancellable: true
            }, async (progress, token) => {
                try {
                    const { stdout, cancelled } = await runLambCli(cliArgs, outputChannel, { 
                        stdinData: sourceCodeToMigrate,
                        token
                    });

                    if (token.isCancellationRequested || cancelled || !stdout) {
                        if (fs.existsSync(tempReportPath)) fs.unlinkSync(tempReportPath);
                        if (cancelled || token.isCancellationRequested) {
                            vscode.window.showWarningMessage('LAMB Migration Task Cancelled.');
                        }
                        return;
                    }

                    // Read confidence report from sidecar report file
                    let ruleScores = [];
                    if (fs.existsSync(tempReportPath)) {
                        try {
                            const reportData = fs.readFileSync(tempReportPath, 'utf8');
                            const parsedReport = JSON.parse(reportData);
                            ruleScores = parsedReport.confidence?.rule_scores || parsedReport.rule_scores || [];
                            
                            // Adjust lines if selection scope was used
                            if (migrationScope === 'selection' && selectionStartLine > 0) {
                                ruleScores = ruleScores.map(score => {
                                    if (score.range) {
                                        return {
                                            ...score,
                                            range: {
                                                ...score.range,
                                                start_line: score.range.start_line + selectionStartLine,
                                                end_line: score.range.end_line + selectionStartLine
                                            }
                                        };
                                    }
                                    return score;
                                });
                            }
                        } catch (e) {
                            console.error("Failed to parse sidecar confidence report:", e);
                        } finally {
                            try { fs.unlinkSync(tempReportPath); } catch (e) {}
                        }
                    }

                    // --- Reconstruct Full File Content if Scope is Selection ---
                    let finalMigratedCode = stdout;
                    if (migrationScope === 'selection') {
                        const beforeSnippet = fullSourceCode.substring(0, selectionStartOffset);
                        const afterSnippet = fullSourceCode.substring(selectionEndOffset);
                        finalMigratedCode = beforeSnippet + stdout + afterSnippet;
                    }

                    const originalFileUri = editor.document.uri;
                    const originalExt = path.extname(originalFileUri.fsPath);
                    const fileRandomId = crypto.randomBytes(4).toString('hex');
                    const tempFilePath = path.join(os.tmpdir(), `lamb_migration_${fileRandomId}${originalExt}`);
                    fs.writeFileSync(tempFilePath, finalMigratedCode, 'utf8');
                    const tempFileUri = vscode.Uri.file(tempFilePath);

                    // Store state for accept/discard title buttons
                    activeMigrationSession = {
                        originalFileUri,
                        tempFilePath,
                        finalMigratedCode,
                        editor
                    };

                    // Enable context key so the check and X buttons appear in editor title menu
                    await vscode.commands.executeCommand('setContext', 'lambMigrationActive', true);

                    // Open diff view
                    await vscode.commands.executeCommand('vscode.diff', originalFileUri, tempFileUri, `${path.basename(originalFileUri.fsPath)} ↔ Migrated Preview (LAMB)`);

                    // Apply confidence highlights to the right pane (modified preview)
                    const applyHighlightsToActiveDiff = () => {
                        const visibleEditors = vscode.window.visibleTextEditors;
                        const targetEditor = visibleEditors.find(e => e.document.uri.fsPath === tempFileUri.fsPath);

                        if (targetEditor) {
                            applyDiffConfidenceGutter(targetEditor, ruleScores);
                            return true;
                        }
                        return false;
                    };

                    if (!applyHighlightsToActiveDiff()) {
                        let retries = 0;
                        const interval = setInterval(() => {
                            retries++;
                            if (applyHighlightsToActiveDiff() || retries > 10) {
                                clearInterval(interval);
                            }
                        }, 200);
                    }

                } catch (err) {
                    if (fs.existsSync(tempReportPath)) {
                        try { fs.unlinkSync(tempReportPath); } catch (e) {}
                    }
                    await cleanupMigrationSession();
                    vscode.window.showErrorMessage(`LAMB Engine Error: ${err.message}`);
                }
            });
        })
    );
}

function deactivate() {
    cleanupMigrationSession();
}

module.exports = { activate, deactivate };