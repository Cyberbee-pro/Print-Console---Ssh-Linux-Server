import { Router } from "express";
import { getStatus, handlePrint, handlePrintContinue } from "../controllers/printController";
import { upload } from "../middleware/uploadMiddleware";

const router = Router();

router.get("/status", getStatus);
router.post("/print", upload.single("file"), handlePrint);
router.post("/print/continue", handlePrintContinue); // Triggers step 2 manual even pass

export default router;