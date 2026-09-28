const vscode = require('vscode');

class HighlightCodeLensProvider {
    constructor(workspaceState) {
        this._workspaceState = workspaceState;
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }

    refresh() {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(document, token) {
        const uriStr = document.uri.toString();
        const records = this._workspaceState.get(`lamb.highlights.${uriStr}`) || [];
        const codeLenses = [];

        records.forEach((highlight, index) => {
            const range = new vscode.Range(
                new vscode.Position(highlight.startLine, highlight.startChar),
                new vscode.Position(highlight.endLine, highlight.endChar)
            );

            // Command that will be executed when clicking the CodeLens directly above the snippet
            const command = {
                title: `$(trash) Delete LAMB Highlight`,
                tooltip: 'Delete the LAMB Highlight for this Source Code Snippet.',
                command: 'lamb-toolsuite.deleteHighlightByIndex',
                arguments: [document.uri, index]
            };

            codeLenses.push(new vscode.CodeLens(range, command));
        });

        return codeLenses;
    }
}

module.exports = HighlightCodeLensProvider;