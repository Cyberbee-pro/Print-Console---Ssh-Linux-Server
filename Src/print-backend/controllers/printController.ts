import type { Request, Response } from "express";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { Client } from "ssh2";

const useStorage = process.env.useStorage === "true";
const STORAGE_POOL = process.env.STORAGE_POOL || "/srv/PrintConsoleStorage";
const DROP_ZONE = process.env.DROP_ZONE_PATH || "/srv/PrintConsoleStorage/printConsole";

const sshConfig = {
    host: process.env.serverIp || "127.0.0.1",
    port: Number(process.env.serverPort) || 22,
    username: process.env.sshUsr || "userName",
    privateKey: process.env.sshKey || ""
};

const executeRemoteCommand = (conn: Client, cmd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let data = "";
            let stderr = "";

            stream.on("data", (chunk: Buffer) => {
                data += chunk.toString();
            });

            stream.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
            });

            stream.on("close", (code: number) => {
                if (code !== 0) {
                    return reject(new Error(stderr || `Exit code ${code}`));
                }
                resolve(data);
            });
        });
    });
};

const buildLpArguments = (body: any): string[] => {
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
    if (body.colorMode === "mono") {
        options.push("-o", "color-model=gray");
    } else {
        options.push("-o", "color-model=color");
    }

    // 3. Duplex Binding Layout Mapping
    if (body.duplexMode === "duplex") {
        options.push("-o", "sides=two-sided-long-edge");
    } else {
        options.push("-o", "sides=one-sided");
    }

    // 4. CUPS Ingress Page-Range Mapping
    if (body.pageMode === "custom" && body.customPages) {
        // Formats clean flag string matching CUPS standard: -o page-ranges=1-4,7
        options.push("-o", `page-ranges=${body.customPages.trim()}`);
    }

    return options;
};

export const getStatus = async (req: Request, res: Response): Promise<void> => {
    const subDirs = ["received", "queue", "printed"];

    if (useStorage) {
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
            res.status(500).json({ status: "error", message: "Failed to scan local storage." });
        }
    } else {
        const conn = new Client();
        conn.on("ready", () => {
            const remoteCmd = `ls -m ${STORAGE_POOL}/received; echo "---"; ls -m ${STORAGE_POOL}/queue; echo "---"; ls -m ${STORAGE_POOL}/printed`;

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
        }).connect(sshConfig);
    }
};

export const handlePrint = async (req: Request, res: Response): Promise<any> => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ status: "error", message: "No file payload parsed." });
        }

        // Catch incoming custom parameter scopes
        const { pageMode, customPages } = req.body;

        // 1. Fail-Fast Guard Clause: Block transactions if range options are structurally broken
        if (pageMode === "custom" && (!customPages || customPages.trim() === "")) {
            // Unlink dynamic temp buffers instantly out of disk scope if using local storage pool
            if (useStorage && file.path && fs.existsSync(file.path)) {
                await unlink(file.path);
            }
            return res.status(400).json({ 
                status: "error", 
                message: "Validation Failure: Selected custom range requires valid page definitions." 
            });
        }

        const cleanExt = path.extname(file.originalname);
        const uniqueName = useStorage ? file.filename : `${Date.now()}-${crypto.randomUUID()}${cleanExt}`;
        const dynamicArgs = buildLpArguments(req.body);

        if (useStorage) {
            const dropZoneFilePath = file.path;
            const printerName = process.env.PrinterName;
            const isMock = process.env.MOCK_PRINT === "true";

            if (!isMock && !printerName) {
                console.error("[CRITICAL SYSTEM ERROR]: process.env.PrinterName is uninitialized.");
                return res.status(500).json({
                    status: "error",
                    message: "Server configuration failure: Targeted system printer identifier is missing."
                });
            }

            const executionBinary = isMock ? "echo" : "lp";
            const fullLpArgs: string[] = isMock
                ? [`[MOCK SPOOLER] Simulating print execution for document: ${uniqueName} with arguments: ${dynamicArgs.join(" ")}`]
                : ["-d", printerName as string, ...dynamicArgs, dropZoneFilePath];

            const printProcess: ChildProcess = spawn(executionBinary, fullLpArgs);

            printProcess.on("close", async (exitCode) => {
                if (exitCode !== 0) {
                    if (fs.existsSync(dropZoneFilePath)) {
                        await unlink(dropZoneFilePath);
                    }
                    return res.status(500).json({ status: "error", message: "Local spooler failure." });
                }
                try {
                    const archiveDestination = path.join(STORAGE_POOL, "received", uniqueName);
                    fs.renameSync(dropZoneFilePath, archiveDestination);
                    res.status(200).json({ status: "success", filename: uniqueName });
                } catch {
                    res.status(500).json({ status: "error", message: "Local archival migration failed." });
                }
            });
        } else {
            const conn = new Client();
            conn.on("ready", () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        res.status(500).json({ status: "error", message: `SFTP subsystem error: ${err.message}` });
                        return conn.end();
                    }

                    const remoteDropPath = path.posix.join(DROP_ZONE, uniqueName);

                    sftp.writeFile(remoteDropPath, file.buffer, (writeErr) => {
                        if (writeErr) {
                            res.status(500).json({ status: "error", message: `Remote disk write failed: ${writeErr.message}` });
                            return conn.end();
                        }

                        const remoteOptionsString = dynamicArgs.join(" ");
                        // Pull the targeted remote printer configuration variable or fall back to system defaults
                        const targetedPrinter = process.env.PrinterName || "Your_Printer_Name";
                        const remotePrintCmd = `lp -d ${targetedPrinter} ${remoteOptionsString} ${remoteDropPath}`;

                        executeRemoteCommand(conn, remotePrintCmd)
                            .then(() => {
                                const remoteArchivePath = path.posix.join(STORAGE_POOL, "received", uniqueName);
                                const moveCmd = `mv ${remoteDropPath} ${remoteArchivePath}`;
                                return executeRemoteCommand(conn, moveCmd);
                            })
                            .then(() => {
                                res.status(200).json({ status: "success", filename: uniqueName });
                                conn.end();
                            })
                            .catch((execErr) => {
                                executeRemoteCommand(conn, `rm ${remoteDropPath}`).finally(() => {
                                    res.status(500).json({ status: "error", message: `Remote pipeline runtime error: ${execErr.message}` });
                                    conn.end();
                                });
                            });
                    });
                });
            }).on("error", (err) => {
                res.status(500).json({ status: "error", message: `SSH Tunnel handshake failed: ${err.message}` });
            }).connect(sshConfig);
        }
    } catch (error) {
        console.error("Fatal backend processing error: ", error);
        res.status(500).json({ status: "error", message: "Fatal backend integration fault." });
    }
};