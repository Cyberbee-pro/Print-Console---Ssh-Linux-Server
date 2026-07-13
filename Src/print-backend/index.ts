import express from "express";
import cors from "cors";
import printRoutes from "./routes/printRoutes";

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.Frontend_Origin || "http://localhost:3000";

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  FRONTEND_ORIGIN.replace(/\/$/, "")
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost:")) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());
app.use("/", printRoutes);

app.listen(Number(PORT), () => {
  console.log(`[HYBRID DAEMON] Active. Port: ${PORT} | Mode: ${process.env.useStorage === "true" ? "LOCAL" : "SERVERLESS_SSH"}`);
});