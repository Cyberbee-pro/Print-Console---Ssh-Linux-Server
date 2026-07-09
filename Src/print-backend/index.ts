import express from "express";
import cors from "cors";
import printRoutes from "./routes/printRoutes";

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize global server filters
app.use(cors());
app.use(express.json());

// Mount the modular routes tree at the root prefix
app.use("/", printRoutes);

app.listen(Number(PORT), () => {
  console.log(`[EXPRESS DAEMON] Running structured backend infrastructure on port ${PORT}`);
});