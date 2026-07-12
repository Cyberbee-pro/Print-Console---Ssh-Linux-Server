// src/utils/api.ts

export interface PrintOptions {
  printMode: "draft" | "standard" | "high";
  colorMode: "color" | "mono";
  duplexMode: "simplex" | "duplex";
  pageMode: "all" | "custom";
  customPages: string;
}

export interface ServerReceipt {
  success: boolean;
  filename: string;
  message: string;
}

/**
 * Packs binary components and execution variables into a Multipart FormData package 
 * and handles dispatch across the localhost loopback.
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
  // Fire async payload over the local network loop
  const response = await fetch(`${backendUrl}/print`, {
    method: "POST",
    body: formData, // Fetch naturally injects the boundary multipart headers automatically
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Ingress system rejected request with status: ${response.status}`);
  }

  return response.json();
};