// src/utils/api.ts

export interface PrintOptions {
  printMode: "draft" | "standard" | "high";
  colorMode: "color" | "mono";
  duplexMode: "simplex" | "duplex" | "manual";
  pageMode: "all" | "custom";
  customPages: string;
}

export interface ServerReceipt {
  status: "success" | "holding";
  filename: string;
  step?: "flip_pages";
  originalBody?: PrintOptions;
  message?: string;
}

/**
 * Packs binary components and execution variables into a Multipart FormData package 
 * and handles dispatch across the network gateway.
 */
export const sendPrintJobToServer = async (
  file: File,
  settings: PrintOptions
): Promise<ServerReceipt> => {
  const formData = new FormData();
  
  // Append the raw binary file stream
  formData.append("file", file);
  
  // Flatten and append the layout configuration properties
  formData.append("printMode", settings.printMode);
  formData.append("colorMode", settings.colorMode);
  formData.append("duplexMode", settings.duplexMode);
  formData.append("pageMode", settings.pageMode);
  formData.append("customPages", settings.customPages);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
  
  // Route to the root backend endpoint directly to avoid path mismatches
  const response = await fetch(`${backendUrl}/print`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Ingress system rejected request with status: ${response.status}`);
  }

  return response.json();
};

export interface PipelineState {
  received: { count: number; files: string[] };
  queue: { count: number; files: string[] };
  printed: { count: number; files: string[] };
}

export const fetchPipelineStatus = async (): Promise<PipelineState> => {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
  const response = await fetch(`${backendUrl}/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch pipeline status: ${response.statusText}`);
  }
  const result = await response.json();
  return result.data;
};