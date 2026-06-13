import { Hono } from "hono";
import { apiKeyMiddleware } from "../../middleware/api-key";
import * as ErrorsController from "../../controllers/v1/ErrorsController";

const router = new Hono();

// Flare error protocol ingress (flat attributes + stacktrace + events).
router.post("/", apiKeyMiddleware, ErrorsController.submitError);

export default router;
