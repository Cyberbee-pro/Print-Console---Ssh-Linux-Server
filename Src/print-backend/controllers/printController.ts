import type { Request, Response } from "express";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { Client } from "ssh2";

const isSelfHost = process.env.SELF_HOST === "true" || process.env.SSH_ENABLED === "false";
const STORAGE_POOL = process.env.STORAGE_POOL || process.env.STORAGE_POOL_PATH || "/srv/PrintConsoleStorage";
const DROP_ZONE = process.env.DROP_ZONE_PATH || "/srv/PrintConsoleStorage/printConsole";

/**
 * Lazy-loads SSH configurations only when remote tunneling mode is active.
 * Bypassed entirely when self-hosting is active.
 */
const getSshConfig = () => {
    const host = process.env.serverIp || process.env.SSH_HOST;
    const port = Number(process.env.serverPort || process.env.SSH_PORT) || 22;
    const username = process.env.sshUsr || process.env.SSH_USER;
    let privateKey = process.env.sshKey || process.env.SSH_KEY_PATH;

    if (!host || !username || !privateKey) {
        throw new Error("Configuration Fault: Missing target remote credentials inside environment context.");
    }

    // Resolve file paths for private SSH key if key path is passed
    if (typeof privateKey === "string" && (privateKey.startsWith("/") || privateKey.startsWith("~") || privateKey.includes("/") || privateKey.includes("\\"))) {
        try {
            if (fs.existsSync(privateKey)) {
                privateKey = fs.readFileSync(privateKey, "utf8");
            }
        } catch (e) {
            // Ignore error, fallback to raw key content
        }
    }

    return {
        host,
        port,
        username,
        privateKey
    };
};

const executeRemoteCommand = (conn: Client, cmd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let data = "";
            let stderr = "";

            stream.on("data", (chunk: Buffer) => { data += chunk.toString(); });
            stream.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
            stream.on("close", (code: number) => {
                if (code !== 0) return reject(new Error(stderr || `Exit code ${code}`));
                resolve(data);
            });
        });
    });
};

const buildLpArguments = (body: any, targetStep?: "odd" | "even"): string[] => {
    const options: string[] = [];

    // 1. Resolution Density Mapping
    switch (body.printMode) {
        case "draft":
            options.push("-o", "print-quality=3", "-o", "resolution=300dpi");
            break;
        case "high":
            options.push("-o", "print-quality=5", "-o", "resolution=1200dpi");
            break;
        case "standard":
        default:
            options.push("-o", "print-quality=4", "-o", "resolution=600dpi");
            break;
    }

    // 2. Chromatic Scale Mapping
    options.push("-o", body.colorMode === "mono" ? "color-model=gray" : "color-model=color");

    // 3. Manual Duplex Step Selection Rules
    if (body.duplexMode === "manual") {
        const currentStep = targetStep || body.duplexStep || "odd";
        options.push("-o", `page-set=${currentStep}`, "-o", "sides=one-sided");
    } else {
        options.push("-o", body.duplexMode === "duplex" ? "sides=two-sided-long-edge" : "sides=one-sided");
    }

    // 4. Custom Range Ingress Check
    if (body.pageMode === "custom" && body.customPages) {
        options.push("-o", `page-ranges=${body.customPages.trim()}`);
    }

    return options;
};

// --- GET PIPELINE STATUS CORE ENGINE ---
export const getStatus = async (req: Request, res: Response): Promise<void> => {
    const subDirs = ["received", "queue", "printed"];

    if (isSelfHost) {
        try {
            const scanPromises = subDirs.map(async (dir) => {
                const targetPath = path.join(STORAGE_POOL, dir);
                try {
                    const files = await readdir(targetPath);
                    return { dir, files };
                } catch {
                    return { dir, files: [] };
                }
            });
            const results = await Promise.all(scanPromises);
            const pipelineState = results.reduce((acc, current) => {
                acc[current.dir] = { count: current.files.length, files: current.files };
                return acc;
            }, {} as Record<string, { count: number; files: string[] }>);

            res.status(200).json({ status: "success", data: pipelineState });
        } catch (error) {
            res.status(500).json({ status: "error", message: "Failed to scan local storage directories." });
        }
    } else {
        try {
            const currentSshConfig = getSshConfig();
            const conn = new Client();
            conn.on("ready", () => {
                const remoteCmd = `ls -m "${STORAGE_POOL}/received"; echo "---"; ls -m "${STORAGE_POOL}/queue"; echo "---"; ls -m "${STORAGE_POOL}/printed"`;

                executeRemoteCommand(conn, remoteCmd)
                    .then((output) => {
                        const sections = output.split("---");
                        const parseSection = (text: string) => {
                            const clean = text.trim();
                            return clean ? clean.split(",").map(f => f.trim()) : [];
                        };

                        const pipelineState = {
                            received: { files: parseSection(sections[0]), count: parseSection(sections[0]).length },
                            queue: { files: parseSection(sections[1]), count: parseSection(sections[1]).length },
                            printed: { files: parseSection(sections[2]), count: parseSection(sections[2]).length }
                        };

                        res.status(200).json({ status: "success", data: pipelineState });
                        conn.end();
                    })
                    .catch((err) => {
                        res.status(500).json({ status: "error", message: `Remote tracking error: ${err.message}` });
                        conn.end();
                    });
            }).on("error", (err) => {
                res.status(500).json({ status: "error", message: `SSH Connection failure: ${err.message}` });
            }).connect(currentSshConfig);
        } catch (configError: any) {
            res.status(500).json({ status: "error", message: configError.message });
        }
    }
};

// --- POST PRIMARY PRINT PROCESSING DISPATCH (STEP 1) ---
export const handlePrint = async (req: Request, res: Response): Promise<any> => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ status: "error", message: "No file payload parsed." });
        }

        const { pageMode, customPages, duplexMode } = req.body;

        if (pageMode === "custom" && (!customPages || customPages.trim() === "")) {
            if (file.path && fs.existsSync(file.path)) {
                await unlink(file.path);
            }
            return res.status(400).json({ status: "error", message: "Validation Failure: Selected custom range requires parameters." });
        }

        const cleanExt = path.extname(file.originalname);
        const uniqueName = file.filename || `${Date.now()}-${crypto.randomUUID()}${cleanExt}`;
        
        const targetStep = duplexMode === "manual" ? "odd" : undefined;
        const dynamicArgs = buildLpArguments(req.body, targetStep);

        if (isSelfHost) {
            let dropZoneFilePath = file.path;

            // Handle memory storage mode for local printing
            if (!dropZoneFilePath) {
                dropZoneFilePath = path.join(DROP_ZONE, uniqueName);
                if (!fs.existsSync(DROP_ZONE)) {
                    fs.mkdirSync(DROP_ZONE, { recursive: true });
                }
                fs.writeFileSync(dropZoneFilePath, file.buffer);
            }

            const printerName = process.env.PrinterName;
            const isMock = process.env.MOCK_PRINT === "true";

            const executionBinary = isMock ? "echo" : "lp";
            const fullLpArgs: string[] = [];

            if (isMock) {
                const targetPrinterLog = printerName && printerName.trim() !== "" ? printerName : "SYSTEM_DEFAULT_PRINTER";
                fullLpArgs.push(`[MOCK SPOOLER] Spooling pass [ODD/BASE] to target [${targetPrinterLog}] for: ${uniqueName} with args: ${dynamicArgs.join(" ")}`);
            } else {
                // If specific printer variable is set, append target flags. Otherwise omit to fall back to system default.
                if (printerName && printerName.trim() !== "") {
                    fullLpArgs.push("-d", printerName.trim());
                }
                fullLpArgs.push(...dynamicArgs, dropZoneFilePath);
            }

            console.log(`\n=== SELF-HOST INTERCEPT: PASS 1 (ODD SIDES) ===`);
            console.log(`Command Line Array: ${executionBinary} ${fullLpArgs.join(" ")}\n`);

            const printProcess: ChildProcess = spawn(executionBinary, fullLpArgs);

            printProcess.on("close", async (exitCode) => {
                if (exitCode !== 0) {
                    if (dropZoneFilePath && fs.existsSync(dropZoneFilePath)) await unlink(dropZoneFilePath);
                    return res.status(500).json({ 
                        status: "error", 
                        message: "Local hardware driver execution failed. Verify your system default printer setup or process.env.PrinterName values." 
                    });
                }

                if (duplexMode === "manual") {
                    return res.status(200).json({
                        status: "holding",
                        step: "flip_pages",
                        filename: uniqueName,
                        originalBody: req.body,
                        message: "Odd page execution pass complete. Ingress hold active. Awaiting tray manual page orientation shift."
                    });
                }

                try {
                    const archiveDestination = path.join(STORAGE_POOL, "printed", uniqueName);
                    fs.renameSync(dropZoneFilePath, archiveDestination);
                    res.status(200).json({ status: "success", filename: uniqueName });
                } catch {
                    res.status(500).json({ status: "error", message: "Local archival migration failed." });
                }
            });
        } else {
            // REMOTE TUNNEL PASS
            const currentSshConfig = getSshConfig();
            const conn = new Client();
            const printerName = process.env.PrinterName;

            conn.on("ready", () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        res.status(500).json({ status: "error", message: `SFTP subsystem error: ${err.message}` });
                        return conn.end();
                    }

                    const remoteDropPath = path.posix.join(DROP_ZONE, uniqueName);
                    const fileBuffer = file.buffer || fs.readFileSync(file.path);

                    sftp.writeFile(remoteDropPath, fileBuffer, (writeErr) => {
                        if (writeErr) {
                            res.status(500).json({ status: "error", message: `Remote disk write failed: ${writeErr.message}` });
                            return conn.end();
                        }

                        const remoteOptionsString = dynamicArgs.join(" ");
                        const remotePrintCmd = printerName && printerName.trim() !== ""
                            ? `lp -d "${printerName.trim()}" ${remoteOptionsString} "${remoteDropPath}"`
                            : `lp ${remoteOptionsString} "${remoteDropPath}"`;

                        executeRemoteCommand(conn, remotePrintCmd)
                            .then(() => {
                                if (duplexMode === "manual") {
                                    res.status(200).json({
                                        status: "holding",
                                        step: "flip_pages",
                                        filename: uniqueName,
                                        originalBody: req.body,
                                        message: "Remote hardware executed odd pass matrix. Storage retained in cache."
                                    });
                                    conn.end();
                                } else {
                                    const remoteArchivePath = path.posix.join(STORAGE_POOL, "printed", uniqueName);
                                    const moveCmd = `mv "${remoteDropPath}" "${remoteArchivePath}"`;
                                    executeRemoteCommand(conn, moveCmd).then(() => {
                                        res.status(200).json({ status: "success", filename: uniqueName });
                                        conn.end();
                                    });
                                }
                            })
                            .catch((execErr) => {
                                executeRemoteCommand(conn, `rm "${remoteDropPath}"`).finally(() => {
                                    res.status(500).json({ status: "error", message: `Remote hardware driver execution failed: ${execErr.message}` });
                                    conn.end();
                                });
                            });
                    });
                });
            }).on("error", (err) => {
                res.status(500).json({ status: "error", message: `SSH Tunnel handshake failed: ${err.message}` });
            }).connect(currentSshConfig);
        }
    } catch (error) {
        console.error("Fatal backend processing error: ", error);
        res.status(500).json({ status: "error", message: "Fatal backend integration fault." });
    }
};

// --- POST MANUAL DUPLEX PHASE 2 COMPLETION (STEP 2: EVEN PAGES) ---
export const handlePrintContinue = async (req: Request, res: Response): Promise<any> => {
    try {
        const { filename, originalBody } = req.body;
        if (!filename || !originalBody) {
            return res.status(400).json({ status: "error", message: "Missing required multi-step job context tracking elements." });
        }

        const dynamicArgs = buildLpArguments(originalBody, "even");

        if (isSelfHost) {
            const dropZoneFilePath = path.join(DROP_ZONE, filename);
            const printerName = process.env.PrinterName;
            const isMock = process.env.MOCK_PRINT === "true";

            if (!fs.existsSync(dropZoneFilePath)) {
                return res.status(404).json({ status: "error", message: "Target staging file buffer expired or evicted from spool pool." });
            }

            const executionBinary = isMock ? "echo" : "lp";
            const fullLpArgs: string[] = [];

            if (isMock) {
                const targetPrinterLog = printerName && printerName.trim() !== "" ? printerName : "SYSTEM_DEFAULT_PRINTER";
                fullLpArgs.push(`[MOCK SPOOLER] Spooling pass [EVEN/FINAL] to target [${targetPrinterLog}] for: ${filename} with args: ${dynamicArgs.join(" ")}`);
            } else {
                if (printerName && printerName.trim() !== "") {
                    fullLpArgs.push("-d", printerName.trim());
                }
                fullLpArgs.push(...dynamicArgs, dropZoneFilePath);
            }

            console.log(`\n=== SELF-HOST INTERCEPT: PASS 2 (EVEN SIDES) ===`);
            console.log(`Command Line Array: ${executionBinary} ${fullLpArgs.join(" ")}\n`);

            const printProcess: ChildProcess = spawn(executionBinary, fullLpArgs);

            printProcess.on("close", async (exitCode) => {
                if (exitCode !== 0) {
                    if (fs.existsSync(dropZoneFilePath)) await unlink(dropZoneFilePath);
                    return res.status(500).json({ 
                        status: "error", 
                        message: "Local hardware failure during finishing pass. Verify system printer setup or process.env.PrinterName values." 
                    });
                }
                try {
                    const archiveDestination = path.join(STORAGE_POOL, "printed", filename);
                    fs.renameSync(dropZoneFilePath, archiveDestination);
                    res.status(200).json({ status: "success", filename });
                } catch {
                    res.status(500).json({ status: "error", message: "Local archival migration failed on completion pass." });
                }
            });
        } else {
            // REMOTE TUNNEL EVEN CONTINUATION
            const currentSshConfig = getSshConfig();
            const conn = new Client();
            const remoteDropPath = path.posix.join(DROP_ZONE, filename);
            const printerName = process.env.PrinterName;
            const remoteOptionsString = dynamicArgs.join(" ");
            
            const remotePrintCmd = printerName && printerName.trim() !== ""
                ? `lp -d "${printerName.trim()}" ${remoteOptionsString} "${remoteDropPath}"`
                : `lp ${remoteOptionsString} "${remoteDropPath}"`;

            conn.on("ready", () => {
                executeRemoteCommand(conn, remotePrintCmd)
                    .then(() => {
                        const remoteArchivePath = path.posix.join(STORAGE_POOL, "printed", filename);
                        const moveCmd = `mv "${remoteDropPath}" "${remoteArchivePath}"`;
                        return executeRemoteCommand(conn, moveCmd);
                    })
                    .then(() => {
                        res.status(200).json({ status: "success", filename });
                        conn.end();
                    })
                    .catch((execErr) => {
                        executeRemoteCommand(conn, `rm "${remoteDropPath}"`).finally(() => {
                            res.status(500).json({ status: "error", message: `Remote manual duplex finishing pass crashed: ${execErr.message}` });
                            conn.end();
                        });
                    });
            }).on("error", (err) => {
                res.status(500).json({ status: "error", message: `SSH Connection loss: ${err.message}` });
            }).connect(currentSshConfig);
        }
    } catch (error) {
        console.error("Fatal continuation tracking engine exception: ", error);
        res.status(500).json({ status: "error", message: "Internal multi-step router execution crash." });
    }
};