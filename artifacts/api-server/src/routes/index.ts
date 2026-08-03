import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import farmsRouter from "./farms";
import analysesRouter from "./analyses";
import fertilizersRouter from "./fertilizers";
import recommendationsRouter from "./recommendations";
import credentialsRouter from "./credentials";
import conversationsRouter from "./conversations";
import reportsRouter from "./reports";
import phytoRouter from "./phyto";
import miscRouter from "./misc";
import adminRouter from "./admin";
import signupRouter from "./signup";
import adminInstallationsRouter from "./adminInstallations";
import adminBillingRouter from "./adminBilling";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// Público (sin sesión): contratación online y webhooks de PayPal — debe ir
// antes de los routers que aplican requireAuth a nivel global.
router.use(signupRouter);
router.use(farmsRouter);
router.use(analysesRouter);
router.use(fertilizersRouter);
router.use(recommendationsRouter);
router.use(credentialsRouter);
router.use(conversationsRouter);
router.use(reportsRouter);
router.use(phytoRouter);
router.use(miscRouter);
router.use(adminRouter);
router.use(adminInstallationsRouter);
router.use(adminBillingRouter);

export default router;
