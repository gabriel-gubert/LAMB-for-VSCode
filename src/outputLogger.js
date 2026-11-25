// Strip ECMA-48 CSI sequences, OSC sequences, 8-bit C1 sequences, and 2-byte ESC sequences.
const ANSI_ESCAPE_REGEX = /[\u001B\u009B](?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\^_])/g;
const CONTROL_CHAR_REGEX = /[\u0007\u0008]/g;

/**
 * Removes ANSI escape sequences and stray BEL/BS control characters while preserving UTF-8 symbols and whitespace.
 */
function stripAnsi(text) {
    if (text == null) {
        return '';
    }
    return String(text)
        .replace(ANSI_ESCAPE_REGEX, '')
        .replace(CONTROL_CHAR_REGEX, '');
}

/**
 * Normalizes trailing CRLF and collapses internal carriage-return progress overwrites (e.g. tqdm) to the latest frame.
 */
function collapseCarriageReturns(line) {
    if (line == null) {
        return '';
    }
    const withoutTrailingCr = String(line).endsWith('\r')
        ? String(line).slice(0, -1)
        : String(line);

    if (!withoutTrailingCr.includes('\r')) {
        return withoutTrailingCr;
    }

    const segments = withoutTrailingCr.split('\r');
    for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].length > 0) {
            return segments[i];
        }
    }
    return '';
}

/**
 * Creates a line-buffered stderr logger that reassembles split escape sequences,
 * collapses carriage returns, strips ANSI codes, and appends clean lines to a VS Code OutputChannel.
 */
function createStderrStreamLogger(outputChannel) {
    let buffer = '';

    function emitLine(rawLine) {
        const clean = stripAnsi(collapseCarriageReturns(rawLine));
        if (outputChannel) {
            outputChannel.appendLine(clean);
        }
    }

    function write(chunk) {
        if (!chunk) {
            return;
        }
        buffer += String(chunk);
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            emitLine(line);
        }
    }

    function flush() {
        if (buffer.length > 0) {
            emitLine(buffer);
            buffer = '';
        }
    }

    return { write, flush };
}

module.exports = {
    stripAnsi,
    collapseCarriageReturns,
    createStderrStreamLogger
};
