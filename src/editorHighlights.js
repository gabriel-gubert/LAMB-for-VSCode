const vscode = require('vscode');

const highSeverityDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 50, 50, 0.25)',
    borderBottom: '2px solid red'
});
const medSeverityDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 200, 0, 0.25)',
    borderBottom: '2px solid orange'
});
const lowSeverityDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(0, 255, 100, 0.25)',
    borderBottom: '2px solid green'
});
const dontTouchDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(175, 238, 238, 0.3)',
    borderBottom: '2px solid #00cccc'
});

function updateEditorVisualHighlights(editor, workspaceState) {
    if (!editor || !workspaceState) return;
    const uriStr = editor.document.uri.toString();
    const records = workspaceState.get(`lamb.highlights.${uriStr}`) || [];
    const redRanges = []; const yellowRanges = []; const greenRanges = []; const iceBlueRanges = [];

    records.forEach(item => {
        const range = new vscode.Range(
            new vscode.Position(item.startLine, item.startChar),
            new vscode.Position(item.endLine, item.endChar)
        );
        if (item.severity === 'critical') redRanges.push(range);
        else if (item.severity === 'warning') yellowRanges.push(range);
        else if (item.severity === 'info') greenRanges.push(range);
        else if (item.severity === 'dontTouch' || item.severity === 'dont_touch') iceBlueRanges.push(range);
    });

    editor.setDecorations(highSeverityDecoration, redRanges);
    editor.setDecorations(medSeverityDecoration, yellowRanges);
    editor.setDecorations(lowSeverityDecoration, greenRanges);
    editor.setDecorations(dontTouchDecoration, iceBlueRanges);
}

module.exports = {
    updateEditorVisualHighlights
};