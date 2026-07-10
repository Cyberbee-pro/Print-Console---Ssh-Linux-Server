import multer from "multer";
import path from "node:path";

const useStorage = process.env.useStorage === "true";
const DROP_ZONE = process.env.DROP_ZONE_PATH || "/srv/PrintConsoleStorage/printConsole";

let storageConfig;

if (useStorage) {
  // Mode A: Persistent local server storage
  storageConfig = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, DROP_ZONE);
    },
    filename: (req, file, cb) => {
      const cleanExt = path.extname(file.originalname);
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}${cleanExt}`;
      cb(null, uniqueName);
    },
  });
} else {
  // Mode B: Serverless stateless runtime memory allocation
  storageConfig = multer.memoryStorage();
}

export const upload = multer({ storage: storageConfig });