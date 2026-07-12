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

  // Fire async payload over the local network loop
  const response = await fetch("http://localhost:3001/api/print", {
    method: "POST",
    body: formData, // Fetch naturally injects the boundary multipart headers automatically
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Ingress system rejected request with status: ${response.status}`);
  }

  return response.json();
};