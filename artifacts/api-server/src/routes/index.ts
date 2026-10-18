import { Router, type IRouter } from "express";
import healthRouter from "./health";
import paydRouter, { webhookRouter } from "./payd";
import settingsRouter from "./settings";
import adminRouter from "./admin";
import authRouter from "./auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Team-only routes enforce platform-verified access in their router.
router.use(adminRouter);

// Public routes — no auth required
router.use(healthRouter);
router.use(authRouter);
router.use(webhookRouter);

// Protected routes — must be logged in
router.use(requireAuth, paydRouter);
router.use(requireAuth, settingsRouter);

export default router;
