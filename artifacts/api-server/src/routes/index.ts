import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import botRouter from "./bot";
import serversRouter from "./servers";
import usersRouter from "./users";
import apisRouter from "./apis";
import personalityRouter from "./personality";
import portalRouter from "./portal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(botRouter);
router.use(serversRouter);
router.use(usersRouter);
router.use(apisRouter);
router.use(personalityRouter);
router.use(portalRouter);

export default router;
