import { Router } from "express";
import { getStatus, handlePrint } from "../controllers/printController";
import { upload } from "../middleware/uploadMiddleware";

const router = Router();

router.get("/status", getStatus);
router.post("/print", upload.single("file"), handlePrint);

export default router;