import { Hono } from "hono";
import { apiKeyMiddleware } from "../../middleware/api-key";
import { auth } from "../../middleware/auth";
import * as LogsController from "../../controllers/v1/LogsController";

const router = new Hono();

router.post("/", apiKeyMiddleware, LogsController.ingest);
router.get("/tail", auth(), LogsController.tail);
router.get("/stats", auth(), LogsController.stats);

export default router;
