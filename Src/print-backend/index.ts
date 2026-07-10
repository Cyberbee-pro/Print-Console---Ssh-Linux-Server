import express from "express";
import cors from "cors";
import printRoutes from "./routes/printRoutes";

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.Frontend_Origin || "http://localhost:3000";

// Standard production-grade CORS filtering using your config variable
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());
app.use("/", printRoutes);

app.listen(Number(PORT), () => {
  console.log(`[HYBRID DAEMON] Active. Storage Mode: ${process.env.useStorage === "true" ? "LOCAL" : "SERVERLESS_SSH"}`);
});