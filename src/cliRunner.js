const vscode = require('vscode');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { stripAnsi, createStderrStreamLogger } = require('./outputLogger');

function getLambEnvPaths() {
    const venvDir = path.join(os.homedir(), '.lamb', 'venv');
    const isWin = process.platform === 'win32';
    const binDir = isWin ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
    const lambBin = path.join(binDir, isWin ? 'lamb.exe' : 'lamb');
    const pythonExec = path.join(binDir, isWin ? 'python.exe' : 'python');
    const venvPip = path.join(binDir, isWin ? 'pip.exe' : 'pip');

    const env = {
        ...process.env,
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1',
        VIRTUAL_ENV: venvDir,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
    };

    return { venvDir, isWin, binDir, lambBin, pythonExec, venvPip, env };
}

async function ensureLambPythonEnv(extensionPath) {
    const { venvDir, isWin, pythonExec: venvPython, venvPip } = getLambEnvPaths();

    if (fs.existsSync(venvPython)) {
        return venvDir;
    }

    const vendorDir = path.join(extensionPath, 'vendor');
    let localPackagePath = null;

    if (fs.existsSync(vendorDir)) {
        const packageFiles = fs.readdirSync(vendorDir).filter(f => f.endsWith('.whl') || f.endsWith('.tar.gz'));
        if (packageFiles.length > 0) {
            localPackagePath = path.join(vendorDir, packageFiles[0]);
        }
    }

    if (!localPackagePath) {
        vscode.window.showErrorMessage("LAMB Setup Failed: No local .whl or .tar.gz package found in LAMB.");
        return null;
    }

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Setting up LAMB Environment...",
        cancellable: false
    }, async (progress) => {
        return new Promise((resolve, reject) => {
            progress.report({ message: "Creating Python Virtual Environment at ~/.lamb/venv..." });

            const sysPython = isWin ? 'python' : 'python3';
            
            execFile(sysPython, ['-m', 'venv', venvDir], (envErr) => {
                if (envErr) {
                    vscode.window.showErrorMessage(`Failed to create Python Virtual Environment at ~/.lamb/venv: ${envErr.message}`);
                    return reject(envErr);
                }

                progress.report({ message: `Installing ${path.basename(localPackagePath)}...` });

                execFile(venvPip, ['install', localPackagePath], (installErr) => {
                    if (installErr) {
                        vscode.window.showErrorMessage(`Failed LAMB Installation: ${installErr.message}`);
                        return reject(installErr);
                    }

                    vscode.window.showInformationMessage("Initialized LAMB Python Virtual Environment.");
                    resolve(venvDir);
                });
            });
        });
    });
}

/**
 * Centralized runner for executing LAMB CLI commands across the extension.
 * Output semantics:
 *  - stdout: Buffer accumulation for data payload (e.g. migrated code)
 *  - stderr: Real-time log streaming directly to VS Code Output Channel
 */
async function runLambCli(cliArgs, outputChannel, options = {}) {
    const { stdinData, token, ...spawnOpts } = options;
    const { venvDir, lambBin, pythonExec, env } = getLambEnvPaths();

    if (!fs.existsSync(venvDir)) {
        throw new Error("LAMB Python Environment at ~/.lamb/venv NOT FOUND. Reload Visual Studio Code.");
    }

    let file;
    let args = [];

    if (fs.existsSync(lambBin)) {
        file = lambBin;
        args = cliArgs;
    } else {
        file = pythonExec;
        args = ['-u', '-m', 'lamb', ...cliArgs];
    }

    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { ...spawnOpts, env });
        const stderrLogger = createStderrStreamLogger(outputChannel);

        let stdoutData = '';
        let stderrData = '';
        let isCancelled = false;

        if (token) {
            token.onCancellationRequested(() => {
                isCancelled = true;
                if (outputChannel) {
                    outputChannel.appendLine('\n[LAMB] Operation CANCELLED by the User.');
                }
                child.kill('SIGTERM');
            });
        }

        // Accumulate stdout data silently in memory
        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        // Stream stderr logs live to output channel (line-buffered and ANSI-stripped)
        if (child.stderr) {
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk) => {
                stderrData += chunk;
                stderrLogger.write(chunk);
            });
        }

        child.on('error', (error) => reject(error));

        child.on('close', (code) => {
            stderrLogger.flush();
            if (isCancelled) {
                return resolve({ stdout: '', stderr: '', cancelled: true });
            }
            if (code !== 0) {
                const cleanStderr = stripAnsi(stderrData).trim();
                return reject(new Error(`Process EXITED with Code ${code}: ${cleanStderr}`));
            }
            resolve({ stdout: stdoutData, stderr: stderrData, cancelled: false });
        });

        if (stdinData && child.stdin) {
            child.stdin.write(stdinData);
            child.stdin.end();
        }
    });
}

/**
 * Executes a short Python snippet inside ~/.lamb/venv without a shell.
 */
function runLambPythonCode(pythonCode, extraArgs = []) {
    const { venvDir, pythonExec, env } = getLambEnvPaths();

    if (!fs.existsSync(venvDir) || !fs.existsSync(pythonExec)) {
        return Promise.reject(new Error('LAMB Python Environment at ~/.lamb/venv NOT FOUND. Reload Visual Studio Code.'));
    }

    return new Promise((resolve, reject) => {
        execFile(pythonExec, ['-c', pythonCode, ...extraArgs], { env }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr ? stripAnsi(stderr).trim() : error.message));
            }
            resolve((stdout || '').trim());
        });
    });
}

module.exports = {
    ensureLambPythonEnv,
    runLambCli,
    getLambEnvPaths,
    runLambPythonCode
};