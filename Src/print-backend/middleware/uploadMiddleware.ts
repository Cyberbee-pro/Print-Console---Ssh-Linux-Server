import multer from "multer";
import path from "node:path";
import fs from "node:fs";

const useStorage = process.env.useStorage === "true";
const STORAGE_POOL = process.env.STORAGE_POOL || process.env.STORAGE_POOL_PATH || "/srv/PrintConsoleStorage";
const DROP_ZONE = process.env.DROP_ZONE_PATH || "/srv/PrintConsoleStorage/printConsole";

// Define all necessary folders needed by the status and archival routines
const REQUIRED_PIPELINE_SUBDIRS = ["received", "queue", "printed"];

const isSelfHost = process.env.SELF_HOST === "true" || process.env.SSH_ENABLED === "false";

if (useStorage || isSelfHost) {
  // 1. Bootstrap the core staging dropzone folder
  if (!fs.existsSync(DROP_ZONE)) {
    fs.mkdirSync(DROP_ZONE, { recursive: true });
  }

  // 2. Bootstrap all storage archive buckets dynamically
  for (const subDir of REQUIRED_PIPELINE_SUBDIRS) {
    const targetFolder = path.join(STORAGE_POOL, subDir);
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }
  }
}

let storageConfig;

if (useStorage) {
  storageConfig = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, DROP_ZONE);
    },
    filename: (req, file, cb) => {
      const cleanExt = path.extname(file.originalname);
      // Safe prefix invocation to protect global execution namespaces
      const uniqueName = `${Date.now()}-${globalThis.crypto.randomUUID()}${cleanExt}`;
      cb(null, uniqueName);
    },
  });
} else {
  storageConfig = multer.memoryStorage();
}

export const upload = multer({ storage: storageConfig });