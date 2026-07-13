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

// Helper to determine if origin is local/private network
const isLocalOrPrivate = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Check localhost or loopback
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return true;
    }
    // Check local mDNS hostname
    if (hostname.endsWith(".local")) {
      return true;
    }
    // Check private network IPv4 addresses:
    // - 10.0.0.0/8
    // - 172.16.0.0/12
    // - 192.168.0.0/16
    // - 100.64.0.0/10 (Tailscale/CGNAT)
    if (/^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d+\.\d+)$/.test(hostname)) {
      return true;
    }
  } catch (e) {
    // Ignore invalid URL format
  }
  return false;
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost:") || isLocalOrPrivate(origin)) {
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