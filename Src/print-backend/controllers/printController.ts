import type { Request, Response } from "express";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { Client } from "ssh2";

const useStorage = (process.env.useStorage === "true");
const STORAGE_POOL = process.env.STORAGE_POOL || "/srv/PrintConsoleStorage";
const DROP_ZONE = process.env.DROP_ZONE_PATH || "/srv/PrintConsoleStorage/printConsole";

// SSH Configuration parameters
const sshConfig = {
    host: process.env.serverIp || "127.0.0.1",
    port: Number(process.env.serverPort) || 22,
    username: process.env.sshUsr || "userName",
    privateKey: process.env.sshKey || ""
};

// Helper utility to execute commands remotely over an established SSH connection
const executeRemoteCommand = (conn: Client, cmd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let data = "";
            let stderr = "";

            // Explicitly type the stream buffer chunks
            stream.on("data", (chunk: Buffer) => {
                data += chunk.toString();
            });

            stream.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
            });

            // Explicitly type the process exit status code
            stream.on("close", (code: number) => {
                if (code !== 0) {
                    return reject(new Error(stderr || `Exit code ${code}`));
                }
                resolve(data);
            });
        });
    });
};

export const getStatus = async (req: Request, res: Response): Promise<void> => {
    const subDirs = ["received", "queue", "printed"];

    if (useStorage) {
        // Mode A: Scan local machine directories
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
            }, {} as any);

            res.status(200).json({ status: "success", data: pipelineState });
        } catch (error) {
            res.status(500).json({ status: "error", message: "Failed to scan local storage." });
        }
    } else {
        // Mode B: Tunnel into home server to check status remotely
        const conn = new Client();
        conn.on("ready", () => {
            // Execute an optimized remote shell command to read all directories concurrently
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

        const cleanExt = path.extname(file.originalname);
        const uniqueName = useStorage ? file.filename : `${Date.now()}-${crypto.randomUUID()}${cleanExt}`;

        if (useStorage) {
            // Mode A: Standard local spooler execution
            const dropZoneFilePath = file.path;
            const printProcess = spawn("lp", ["-d", "Your_Printer_Name", "-o", "print-quality=5", dropZoneFilePath]);

            printProcess.on("close", async (exitCode) => {
                if (exitCode !== 0) {
                    await unlink(dropZoneFilePath);
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
            // Mode B: Serverless Outbound Tunnel Execution Loop
            const conn = new Client();
            conn.on("ready", () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        res.status(500).json({ status: "error", message: `SFTP subsystem error: ${err.message}` });
                        return conn.end();
                    }

                    const remoteDropPath = path.posix.join(DROP_ZONE, uniqueName);

                    // Stream the file directly out of memory buffer straight into the remote SSH socket channel
                    sftp.writeFile(remoteDropPath, file.buffer, (writeErr) => {
                        if (writeErr) {
                            res.status(500).json({ status: "error", message: `Remote disk write failed: ${writeErr.message}` });
                            return conn.end();
                        }

                        // Trigger the print execution command on the target home machine remotely
                        const remotePrintCmd = `lp -d Your_Printer_Name -o print-quality=5 ${remoteDropPath}`;
                        executeRemoteCommand(conn, remotePrintCmd)
                            .then(() => {
                                // Atomic migration on the remote host filesystem post-print execution
                                const remoteArchivePath = path.posix.join(STORAGE_POOL, "received", uniqueName);
                                const moveCmd = `mv ${remoteDropPath} ${remoteArchivePath}`;
                                return executeRemoteCommand(conn, moveCmd);
                            })
                            .then(() => {
                                res.status(200).json({ status: "success", message: "Streamed via SSH tunnel cleanly.", filename: uniqueName });
                                conn.end();
                            })
                            .catch((execErr) => {
                                // Remote cleanup execution sequence if printing fails
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
        res.status(500).json({ status: "error", message: "Fatal backend integration fault." });
    }
};