const vscode = require('vscode');
const path = require('path');
const { runLambCli } = require('./cliRunner');

class MapPanelProvider {
    constructor(extensionUri, outputChannel, context) {
        this._extensionUri = extensionUri;
        this._outputChannel = outputChannel || vscode.window.createOutputChannel('LAMB Output');
        this._context = context;
        this._view = undefined;
        this._currentAbortController = null;
    }

    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            try {
                switch (data.command) {
                    case 'selectFolder': {
                        const options = {
                            canSelectMany: false,
                            canSelectFiles: false,
                            canSelectFolders: true,
                            openLabel: 'Select Directory'
                        };
                        const folderUri = await vscode.window.showOpenDialog(options);
                        if (folderUri && folderUri[0]) {
                            webviewView.webview.postMessage({
                                command: 'folderSelected',
                                targetId: data.targetId,
                                path: folderUri[0].fsPath
                            });
                        }
                        break;
                    }
                    case 'selectFile': {
                        const options = {
                            canSelectMany: false,
                            canSelectFiles: true,
                            canSelectFolders: false,
                            openLabel: 'Select File'
                        };
                        const fileUri = await vscode.window.showOpenDialog(options);
                        if (fileUri && fileUri[0]) {
                            webviewView.webview.postMessage({
                                command: 'folderSelected',
                                targetId: data.targetId,
                                path: fileUri[0].fsPath
                            });
                        }
                        break;
                    }
                    case 'runMap': {
                        await this._executeMapCommand(data.payload);
                        break;
                    }
                    case 'cancelMap': {
                        this._cancelCurrentOperation();
                        break;
                    }
                    case 'saveFormData': {
                        if (this._context && this._context.workspaceState) {
                            await this._context.workspaceState.update('lamb.mapPanelForm', data.payload);
                        }
                        break;
                    }
                    case 'getFormData': {
                        const savedData = this._context && this._context.workspaceState 
                            ? this._context.workspaceState.get('lamb.mapPanelForm') 
                            : null;
                        if (savedData) {
                            webviewView.webview.postMessage({
                                command: 'restoreFormData',
                                payload: savedData
                            });
                        }
                        break;
                    }
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Error handling request: ${err.message}`);
            }
        });
    }

    _cancelCurrentOperation() {
        if (this._currentAbortController) {
            this._currentAbortController.abort();
            this._currentAbortController = null;
            if (this._outputChannel) {
                this._outputChannel.appendLine('\n[LAMB] Cancellation Requested by the User.');
            }
        }
    }

    async _executeMapCommand(payload) {
        const { 
            pathV1, 
            pathV2, 
            alias, 
            output, 
            threadId,
            multiAgent,
            resolverBatchSize,
            discoveryBatchSize,
            stageOutputDir,
            checkpointDatabasePath
        } = payload;

        if (!pathV1 || !pathV2 || !alias) {
            vscode.window.showErrorMessage('[X] Source Root (V1), Target Root (V2), and Mapping Table Alias are STRICTLY REQUIRED FIELDS.');
            return;
        }

        const config = vscode.workspace.getConfiguration('lamb');
        const currentVerbose = config.get('general.verbose', false);

        const cliArgs = ['map', pathV1, pathV2, '--alias', alias];
        if (output) cliArgs.push('--output', output);
        if (threadId) cliArgs.push('--thread-id', threadId);
        if (currentVerbose) cliArgs.push('--verbose');

        if (multiAgent === 'true') {
            cliArgs.push('--multi-agent');
        } else if (multiAgent === 'false') {
            cliArgs.push('--no-multi-agent');
        }

        if (resolverBatchSize !== undefined && resolverBatchSize.trim() !== '') {
            cliArgs.push('--resolver-batch-size', resolverBatchSize.trim());
        }

        if (discoveryBatchSize !== undefined && discoveryBatchSize.trim() !== '') {
            cliArgs.push('--discovery-batch-size', discoveryBatchSize.trim());
        }

        if (stageOutputDir && stageOutputDir.trim() !== '') {
            cliArgs.push('--stage-output-dir', stageOutputDir.trim());
        }

        if (checkpointDatabasePath && checkpointDatabasePath.trim() !== '') {
            cliArgs.push('--checkpoint-database-path', checkpointDatabasePath.trim());
        }

        this._outputChannel.show(true);
        this._currentAbortController = new AbortController();

        // Inform Webview execution started
        if (this._view) {
            this._view.webview.postMessage({ command: 'setRunningState', running: true });
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Generating Mapping Table ${alias}...`,
            cancellable: true
        }, async (progress, token) => {
            const cts = new vscode.CancellationTokenSource();

            // Bridge VS Code notification cancellation to internal controller
            const sub = token.onCancellationRequested(() => {
                this._cancelCurrentOperation();
                cts.cancel();
            });

            // Bridge Webview abort event to cancellation token
            const abortHandler = () => cts.cancel();
            if (this._currentAbortController) {
                this._currentAbortController.signal.addEventListener('abort', abortHandler);
            }

            try {
                const result = await runLambCli(cliArgs, this._outputChannel, { token: cts.token });
                
                if (result && result.cancelled) {
                    vscode.window.showWarningMessage(`Mapping Table Generation Workflow Cancelled.`);
                    return;
                }
                
                vscode.window.showInformationMessage(`Generated Mapping Table '${alias}'.`);
            } catch (error) {
                vscode.window.showErrorMessage(`Mapping Table Generation Workflow Aborted: ${error.message}`);
            } finally {
                sub.dispose();
                if (this._currentAbortController) {
                    this._currentAbortController.signal.removeEventListener('abort', abortHandler);
                }
                this._currentAbortController = null;
                if (this._view) {
                    this._view.webview.postMessage({ command: 'setRunningState', running: false });
                }
            }
        });
    }

    _getHtmlForWebview(webview) {
        const nonce = getNonce();

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px; }
                .field-group { margin-bottom: 12px; display: flex; flex-direction: column; }
                label { font-weight: bold; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
                input[type="text"], input[type="number"], select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; border-radius: 2px; }
                .path-row { display: flex; gap: 4px; }
                .path-row input { flex: 1; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px; font-weight: bold; }
                button:hover { background: var(--vscode-button-hoverBackground); }
                .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
                .btn-cancel { background: var(--vscode-errorForeground, #f44336); color: #ffffff; margin-top: 6px; display: none; }
                .btn-cancel:hover { opacity: 0.9; }
                .action-btn { margin-top: 12px; width: 100%; padding: 8px; }
                .description { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
                details { margin-top: 12px; border: 1px solid var(--vscode-widget-border); padding: 8px; border-radius: 2px; }
                summary { font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
                .overrides-container { margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="field-group">
                <label>Source Version Root (Path V1)</label>
                <div class="path-row">
                    <input type="text" id="path_v1" placeholder="Select the Root Directory for Legacy Version API Documentation...">
                    <button class="btn-secondary" id="btn_browse_v1">Browse</button>
                </div>
            </div>

            <div class="field-group">
                <label>Target Version Root (Path V2)</label>
                <div class="path-row">
                    <input type="text" id="path_v2" placeholder="Select the Root Directory for Current Version API Documentation...">
                    <button class="btn-secondary" id="btn_browse_v2">Browse</button>
                </div>
            </div>

            <div class="field-group">
                <label>Mapping Table Alias</label>
                <input type="text" id="alias" placeholder="e.g., SynthNetLib">
                <div class="description">Identifier used to fetch the Mapping Table during Source Code Migrations Workflows.</div>
            </div>

            <div class="field-group">
                <label>Output Path (Optional)</label>
                <div class="path-row">
                    <input type="text" id="output" placeholder="e.g., ./SynthNetLib.json">
                    <button class="btn-secondary" id="btn_browse_output">Browse</button>
                </div>
                <div class="description">Destination Path for the Mapping Table JSON File.</div>
            </div>

            <div class="field-group">
                <label>LangGraph Thread ID (Optional)</label>
                <input type="text" id="thread_id" placeholder="e.g., run_08f9x">
                <div class="description">Identifier (LangGraph Checkpoint thread_id) used to RESUME a Mapping Table Generation Workflow.</div>
            </div>

            <details id="overrides_details">
                <summary>Execution Overrides</summary>
                <div class="overrides-container">
                    <div class="field-group">
                        <label>Multi-Agent Consensus</label>
                        <select id="multi_agent">
                            <option value="default">Use Config Default</option>
                            <option value="true">Enable (--multi-agent)</option>
                            <option value="false">Disable (--no-multi-agent)</option>
                        </select>
                    </div>

                    <div class="field-group">
                        <label>Resolver Agent Batch Size</label>
                        <input type="number" id="resolver_batch_size" placeholder="e.g., 20">
                    </div>

                    <div class="field-group">
                        <label>Discovery Agent Batch Size</label>
                        <input type="number" id="discovery_batch_size" placeholder="e.g., 20">
                    </div>

                    <div class="field-group">
                        <label>Stage Output Directory</label>
                        <div class="path-row">
                            <input type="text" id="stage_output_dir" placeholder="Override Stage Output Directory...">
                            <button class="btn-secondary" id="btn_browse_stage_dir">Browse</button>
                        </div>
                    </div>

                    <div class="field-group">
                        <label>Checkpoint Database Path</label>
                        <div class="path-row">
                            <input type="text" id="checkpoint_database_path" placeholder="~/.lamb/map_checkpoint.db">
                            <button class="btn-secondary" id="btn_browse_checkpoint_db">Browse</button>
                        </div>
                    </div>
                </div>
            </details>

            <button class="action-btn" id="btn_generate">Generate Mapping Table</button>
            <button class="action-btn btn-cancel" id="btn_cancel">Cancel Mapping Process</button>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                const inputIds = [
                    'path_v1', 'path_v2', 'alias', 'output', 'thread_id',
                    'multi_agent', 'resolver_batch_size', 'discovery_batch_size',
                    'stage_output_dir', 'checkpoint_database_path'
                ];

                function getFormState() {
                    const state = {};
                    inputIds.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) state[id] = el.value;
                    });
                    const details = document.getElementById('overrides_details');
                    if (details) state.overridesOpen = details.open;
                    return state;
                }

                function applyFormState(state) {
                    if (!state) return;
                    inputIds.forEach(id => {
                        const el = document.getElementById(id);
                        if (el && state[id] !== undefined) el.value = state[id];
                    });
                    if (state.overridesOpen !== undefined) {
                        const details = document.getElementById('overrides_details');
                        if (details) details.open = state.overridesOpen;
                    }
                }

                function debounce(func, delay) {
                    let timeout;
                    return function(...args) {
                        clearTimeout(timeout);
                        timeout = setTimeout(() => func.apply(this, args), delay);
                    };
                }

                const triggerAutoSave = debounce(() => {
                    const state = getFormState();
                    vscode.setState(state);
                    vscode.postMessage({ command: 'saveFormData', payload: state });
                }, 300);

                document.getElementById('btn_browse_v1').addEventListener('click', () => browseFolder('path_v1'));
                document.getElementById('btn_browse_v2').addEventListener('click', () => browseFolder('path_v2'));
                document.getElementById('btn_browse_output').addEventListener('click', () => browseFolder('output'));
                document.getElementById('btn_browse_stage_dir').addEventListener('click', () => browseFolder('stage_output_dir'));
                document.getElementById('btn_browse_checkpoint_db').addEventListener('click', () => browseFile('checkpoint_database_path'));
                document.getElementById('btn_generate').addEventListener('click', triggerMapGeneration);
                document.getElementById('btn_cancel').addEventListener('click', triggerMapCancel);

                inputIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.addEventListener('input', triggerAutoSave);
                        el.addEventListener('change', triggerAutoSave);
                    }
                });

                document.getElementById('overrides_details').addEventListener('toggle', triggerAutoSave);

                function browseFolder(targetId) {
                    vscode.postMessage({ command: 'selectFolder', targetId: targetId });
                }

                function browseFile(targetId) {
                    vscode.postMessage({ command: 'selectFile', targetId: targetId });
                }

                function triggerMapGeneration() {
                    const state = getFormState();
                    vscode.setState(state);
                    vscode.postMessage({ command: 'saveFormData', payload: state });

                    const payload = {
                        pathV1: document.getElementById('path_v1').value,
                        pathV2: document.getElementById('path_v2').value,
                        alias: document.getElementById('alias').value,
                        output: document.getElementById('output').value,
                        threadId: document.getElementById('thread_id').value,
                        multiAgent: document.getElementById('multi_agent').value,
                        resolverBatchSize: document.getElementById('resolver_batch_size').value,
                        discoveryBatchSize: document.getElementById('discovery_batch_size').value,
                        stageOutputDir: document.getElementById('stage_output_dir').value,
                        checkpointDatabasePath: document.getElementById('checkpoint_database_path').value
                    };
                    vscode.postMessage({ command: 'runMap', payload: payload });
                }

                function triggerMapCancel() {
                    vscode.postMessage({ command: 'cancelMap' });
                }

                // Restore State Logic:
                const previousWebviewState = vscode.getState();
                if (previousWebviewState) {
                    applyFormState(previousWebviewState);
                } else {
                    vscode.postMessage({ command: 'getFormData' });
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'folderSelected') {
                        const inputEl = document.getElementById(message.targetId);
                        if (inputEl) {
                            inputEl.value = message.path;
                            triggerAutoSave();
                        }
                    } else if (message.command === 'restoreFormData') {
                        applyFormState(message.payload);
                        vscode.setState(message.payload);
                    } else if (message.command === 'setRunningState') {
                        const btnGen = document.getElementById('btn_generate');
                        const btnCancel = document.getElementById('btn_cancel');
                        if (message.running) {
                            btnGen.disabled = true;
                            btnGen.innerText = "Mapping Process Active...";
                            btnCancel.style.display = 'block';
                        } else {
                            btnGen.disabled = false;
                            btnGen.innerText = "Generate Mapping Table";
                            btnCancel.style.display = 'none';
                        }
                    }
                });
            </script>
        </body>
        </html>
        `;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

module.exports = MapPanelProvider;