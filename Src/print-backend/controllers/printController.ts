import { Request, Response } from "express";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "node:fs";

const STORAGE_POOL = process.env.STORAGE_POOL_PATH || "/srv/PrintConsoleStorage";

export const getStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const subDirs = ["received", "queue", "printed"];

        const scanPromises = subDirs.map(async (dir) => {
            const targetPath = path.join(STORAGE_POOL, dir);
            try {
                const files = await readdir(targetPath);
                return { dir, files };
            } catch (err) {
                return { dir, files: [] };
            }
        });

        const results = await Promise.all(scanPromises);

        const pipelineState = results.reduce((acc, current) => {
            acc[current.dir] = {
                count: current.files.length,
                files: current.files,
            };
            return acc;
        }, {} as Record<string, { count: number; files: string[] }>);

        res.status(200).json({ status: "success", data: pipelineState });
    } catch (error) {
        res.status(500).json({ status: "error", message: "Failed to scan storage units." });
    }
};

export const handlePrint = async (req: Request, res: Response): Promise<any> => {
    try {
        const file = req.file;

        if (!file) {
            return res.status(400).json({ status: "error", message: "No file payload parsed." });
        }

        const dropZoneFilePath = file.path;
        const filename = file.filename;

        const printProcess = spawn("lp", [
            "-d", "Your_Printer_Name",
            "-o", "print-quality=5",
            "-o", "resolution=1200dpi",
            dropZoneFilePath
        ]);

        printProcess.on("close", async (exitCode) => {
            if (exitCode !== 0) {
                await unlink(dropZoneFilePath);
                return res.status(500).json({
                    status: "error",
                    message: `CUPS subsystem rejected file processing with code ${exitCode}.`
                });
            }

            try {
                const archiveDestination = path.join(STORAGE_POOL, "received", filename);
                fs.renameSync(dropZoneFilePath, archiveDestination);

                res.status(200).json({
                    status: "success",
                    message: "Document successfully processed through pipeline.",
                    filename
                });
            } catch (migrationError) {
                res.status(500).json({ status: "error", message: "Print succeeded but archival migration failed." });
            }
        });

    } catch (error) {
        res.status(500).json({ status: "error", message: "Internal server pipeline failure." });
    }
};