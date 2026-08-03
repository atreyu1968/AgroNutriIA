import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { csrfProtection, corsOriginCheck } from "./middlewares/csrf";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS restringido: solo orígenes de confianza reciben cabeceras CORS, y las
// credenciales (cookies) solo se comparten con ellos. La web se sirve desde el
// mismo dominio, así que no depende de CORS para funcionar.
app.use(cors({ origin: corsOriginCheck, credentials: true }));
app.use(cookieParser());
// Protección CSRF: rechaza mutaciones autenticadas por cookie cuyo
// Origin/Referer no sea del propio dominio (o de la lista de confianza).
app.use(csrfProtection);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
