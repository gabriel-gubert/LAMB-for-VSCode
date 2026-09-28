const vscode = require('vscode');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function ensureLambPythonEnv(extensionPath) {
    const venvDir = path.join(os.homedir(), '.lamb', 'venv');
    const isWin = process.platform === 'win32';
    
    const binDir = isWin ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
    const venvPython = path.join(binDir, isWin ? 'python.exe' : 'python');
    const venvPip = path.join(binDir, isWin ? 'pip.exe' : 'pip');

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
    const venvDir = path.join(os.homedir(), '.lamb', 'venv');
    const isWin = process.platform === 'win32';

    const binDir = isWin ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
    const lambBin = path.join(binDir, isWin ? 'lamb.exe' : 'lamb');
    const pythonExec = path.join(binDir, isWin ? 'python.exe' : 'python');

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

    const env = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        VIRTUAL_ENV: venvDir,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
    };

    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { ...spawnOpts, env });

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

        // Stream stderr logs live to output channel
        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderrData += chunk;
            if (outputChannel) {
                outputChannel.append(chunk);
            }
        });

        child.on('error', (error) => reject(error));

        child.on('close', (code) => {
            if (isCancelled) {
                return resolve({ stdout: '', stderr: '', cancelled: true });
            }
            if (code !== 0) {
                return reject(new Error(`Process EXITED with Code ${code}: ${stderrData}`));
            }
            resolve({ stdout: stdoutData, stderr: stderrData, cancelled: false });
        });

        if (stdinData && child.stdin) {
            child.stdin.write(stdinData);
            child.stdin.end();
        }
    });
}

module.exports = {
    ensureLambPythonEnv,
    runLambCli
};