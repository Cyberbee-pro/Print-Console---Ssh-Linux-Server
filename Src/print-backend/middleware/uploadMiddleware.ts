import multer from "multer";
import path from "node:path";
import fs from "node:fs"; // Imported to handle folder tree checking

const useStorage = process.env.useStorage === "true";
const DROP_ZONE = process.env.DROP_ZONE_PATH || "/srv/PrintConsoleStorage/printConsole";

// Crucial Guard Clause: Enforce directory structure availability on initialization
if (useStorage && !fs.existsSync(DROP_ZONE)) {
  fs.mkdirSync(DROP_ZONE, { recursive: true });
}

let storageConfig;

if (useStorage) {
  storageConfig = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, DROP_ZONE);
    },
    filename: (req, file, cb) => {
      const cleanExt = path.extname(file.originalname);
      // Modern Node/Bun global environments support crypto natively without explicit imports
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}${cleanExt}`;
      cb(null, uniqueName);
    },
  });
} else {
  storageConfig = multer.memoryStorage();
}

export const upload = multer({ storage: storageConfig });