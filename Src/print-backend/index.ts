import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

// Fallback defaults if .env parameters are missing
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "127.0.0.1";
const DROP_ZONE = process.env.DROP_ZONE_PATH || "/home/printConsole";
const STORAGE_POOL = process.env.STORAGE_POOL_PATH || "/srv/PrintConsoleStorage";

Bun.serve({
  port: Number(PORT),
  hostname: HOST,

  async fetch(request) {
    const url = new URL(request.url);

    // Explicit CORS Preflight Header handling
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ==========================================
    // 1. GET /status - Directory Tracking Engine
    // ==========================================
    if (url.pathname === "/status" && request.method === "GET") {
      try {
        const subDirs = ["received", "queue", "printed"];

        // Execute directory scanning concurrently across the thread pool
        const scanPromises = subDirs.map(async (dir) => {
          const targetPath = path.join(STORAGE_POOL, dir);
          try {
            const files = await readdir(targetPath);
            return { dir, files };
          } catch (err) {
            // Log fallback if directory tree is partially uninitialized
            return { dir, files: [] };
          }
        });

        const results = await Promise.all(scanPromises);

        // Map array down to a structured key-value state dictionary
        const pipelineState = results.reduce((acc, current) => {
          acc[current.dir] = {
            count: current.files.length,
            files: current.files,
          };
          return acc;
        }, {} as Record<string, { count: number; files: string[] }>);

        return Response.json(
          { status: "success", data: pipelineState },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        );
      } catch (error) {
        return Response.json(
          { status: "error", message: "Failed to scan storage components." },
          { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    // ==========================================
    // 2. POST /print - Ingress Data Handler
    // ==========================================
    if (url.pathname === "/print" && request.method === "POST") {
      try {
        // Intercept multipart/form-data stream natively out of memory
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file || file.size === 0) {
          return Response.json(
            { status: "error", message: "Empty or invalid file payload dropped." },
            { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        // Enforce high-entropy file names to avoid write collisions
        const cleanExt = path.extname(file.name);
        const uniqueName = `${Date.now()}-${crypto.randomUUID()}${cleanExt}`;
        const dropZoneFilePath = path.join(DROP_ZONE, uniqueName);

        // Perform zero-copy file write straight to local storage
        await Bun.write(dropZoneFilePath, file);

        // Initialize Direct POSIX Process execution via Bun.spawn
        // Passes optimal quality options directly to line printer interface
        const printProcess = Bun.spawn({
          cmd: ["lp", "-d", "Your_Printer_Name", "-o", "print-quality=5", "-o", "resolution=1200dpi", dropZoneFilePath],
          stdout: "pipe",
          stderr: "pipe",
        });

        // Await binary process exit block resolution
        const exitCode = await printProcess.exited;

        if (exitCode !== 0) {
          const errorDetails = await new Response(printProcess.stderr).text();
          throw new Error(`Spooler execution failure. Exit code: ${exitCode}. Details: ${errorDetails}`);
        }

        // Atomic Shift: Move out of drop zone to archival partition post-print
        const archiveDestination = path.join(STORAGE_POOL, "received", uniqueName);
        await Bun.write(archiveDestination, Bun.file(dropZoneFilePath));
        await unlink(dropZoneFilePath); // Clean up original pointer link

        return Response.json(
          { status: "success", message: "Document dispatched and archived.", filename: uniqueName },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        );
      } catch (error: any) {
        return Response.json(
          { status: "error", message: error.message || "Ingress processing fault." },
          { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    // Routing fallback handler
    return new Response("Invalid endpoint route target", { status: 404 });
  },
});

console.log(`[DAEMON WORKING] Cybees Printing Gateway deployed at http://${HOST}:${PORT}`);
