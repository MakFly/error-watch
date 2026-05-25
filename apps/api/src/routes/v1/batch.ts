import { Hono } from "hono";
import { apiKeyMiddleware } from "../../middleware/api-key";
import * as BatchController from "../../controllers/v1/BatchController";

const router = new Hono();

router.post("/", apiKeyMiddleware, BatchController.submitBatch);

export default router;
