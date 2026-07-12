"use client";

import { Orbit, Exo_2 } from 'next/font/google';
import DecryptedText from '@/components/DecryptedText';
import PixelSnow from '@/components/PixelSnow';
import { SmoothCursor } from "@/components/ui/smooth-cursor";
import { FileUpload } from "@/components/application/file-upload/file-upload-base";
import { useState } from 'react';
import { RippleButton } from '@/components/ui/ripple-button';
import { Dropdown} from "@/components/base/dropdown/dropdown";
import { sendPrintJobToServer } from '@/utils/api';
import { Button as AriaButton } from 'react-aria-components';

// 1. Structural Contracts for Type Safety
interface PrintOptions {
  printMode: "draft" | "standard" | "high";
  colorMode: "color" | "mono";
  duplexMode: "simplex" | "duplex";
  pageMode: "all" | "custom";  // Tracks the active mode selection
  customPages: string;         // Stores the page range string string (e.g., "1-3, 5")
}
interface TrackedPrintJob {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  failed?: boolean;
  errorMessage?: string;
  fileObject?: File;
}

const orbit = Orbit({ 
  subsets: ['latin'], 
  weight: '400', 
});

const exo2 = Exo_2({
  subsets: ['latin'],
  weight: '400',
});

export default function Home() {
  return (
    <div className="relative bg-black min-h-screen overflow-hidden">
      {/* Background Interactive Graphics Layer */}
      <div style={{ width: '100%', height: '100%', position: 'fixed', top: 0, left: 0, zIndex: 0 }}>
        <PixelSnow 
          color="#ffffff"
          flakeSize={0.01}
          minFlakeSize={1.25}
          pixelResolution={200}
          speed={1.25}
          density={0.3}
          direction={125}
          brightness={1}
          depthFade={8}
          farPlane={20}
          gamma={0.4545}
          variant="square"
        />
      </div>

      {/* Main UI Execution Layer */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <Content />
      </div>
      {/* <SmoothCursor /> */}
    </div>
  );
}

const Content = () => {
  // 1. State containers tracking the queue, loading lock, and dropdown settings
  const [uploadedFiles, setUploadedFiles] = useState<TrackedPrintJob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
const [printSettings, setPrintSettings] = useState<PrintOptions>({
  printMode: "high",  // Default to high fidelity matrix
  colorMode: "color",
  duplexMode: "simplex",
  pageMode: "all",       // Default to printing the complete document
  customPages: "",       // Initialized empty string buffer
});
// Replace your old handleOptionSelect block with this warning-free version:
const handleOptionSelect = <K extends keyof PrintOptions>(
  settingKey: K,
  selectedValue: PrintOptions[K]
) => {
  setPrintSettings((previousSettings) => ({
    ...previousSettings,
    [settingKey]: selectedValue,
  }));
};

  // 2. Drop Zone Handler: Stages files in memory at 0% progress
  const handleDropFiles = (files: FileList) => {
    const newFiles = Array.from(files).map((file) => ({
      id: Math.random().toString(),
      name: file.name,
      size: file.size,
      type: file.type,
      progress: 0,
      fileObject: file,
    }));

    setUploadedFiles((prev) => [...newFiles, ...prev]);
  };

  const handleDropUnacceptedFiles = (files: FileList) => {
    console.warn("System blocked unaccepted file ingestion pipeline: ", files);
  };

  const handleDeleteFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== id));
  };

  // 3. The Dispatch Engine: Sequential file streaming loop
  const handleFormSubmission = async (event: React.FormEvent) => {
    event.preventDefault();

    const pendingJobs = uploadedFiles.filter((file) => file.progress < 100);

    if (pendingJobs.length === 0) {
      alert("Validation Error: No pending documents inside the staging queue.");
      return;
    }

    setIsSubmitting(true);

    for (const job of pendingJobs) {
      if (!job.fileObject) continue;

      setUploadedFiles((prev) =>
        prev.map((item) => (item.id === job.id ? { ...item, progress: 10, failed: false } : item))
      );

      try {
      await sendPrintJobToServer(job.fileObject, printSettings);

      setUploadedFiles((prev) =>
        prev.map((item) => (item.id === job.id ? { ...item, progress: 100 } : item))
      );
    } catch (error) {
      // Extract the error string safely by checking if it matches the standard Error object layout
      const message = error instanceof Error ? error.message : "Transmission pipeline failure";

      setUploadedFiles((prev) =>
        prev.map((item) =>
          item.id === job.id
            ? { ...item, progress: 0, failed: true, errorMessage: message }
            : item
        )
      );
    }
    }

    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col p-6 min-h-screen justify-center max-w-4xl mx-auto w-full">
      <div className={`text-4xl md:text-5xl font-bold text-white mb-4 p-3 tracking-widest ${orbit.className}`}>
        <DecryptedText
          text="Welcome to Print Console"
          speed={70}
          maxIterations={19}
          characters="ABCD1234!?"
          className="revealed"
          parentClassName="all-letters"
          encryptedClassName="encrypted"
          animateOn="view"
        />
      </div>
      
      <p className={`text-xl text-zinc-400 mb-8 tracking-wide text-left ${exo2.className}`}>
        Manage your print jobs with ease.
      </p>

      <form onSubmit={handleFormSubmission} className={`grid grid-cols-1 md:grid-cols-2 gap-8 w-full bg-zinc-950/80 border border-zinc-800 p-8 rounded-xl backdrop-blur-md text-white ${exo2.className}`}>
        
        {/* Left Column: File Dropzone & Queue Tracker */}
        <div className="flex flex-col justify-between space-y-4">
          <FileUpload.Root>
            <FileUpload.DropZone
              accept="application/pdf,image/*"
              hint="Drag and drop or select documents for execution loop."
              onDropFiles={handleDropFiles}
              onDropUnacceptedFiles={handleDropUnacceptedFiles}
            />

            <FileUpload.List className="mt-4 space-y-3 max-h-[200px] overflow-y-auto pr-2">
              {uploadedFiles.map((file) => (
                <FileUpload.ListItemProgressBar
                  key={file.id}
                  name={file.name}
                  size={file.size}
                  type={file.name.endsWith('.pdf') ? 'pdf' : file.type.startsWith('image/') ? 'image' : 'empty'}
                  progress={file.progress}
                  failed={file.failed}
                  onDelete={() => handleDeleteFile(file.id)}
                />
              ))}
            </FileUpload.List>
          </FileUpload.Root>
        </div>

{/* Right Column: Configurations & Action Dispatch Trigger */}
        <div className="flex flex-col gap-5 justify-between">
          <div className="flex flex-col gap-5">
            
            {/* Resolution Dropdown */}
            <div>
              <label className={`block text-sm font-semibold tracking-wider text-zinc-400 mb-2 text-emerald-400 ${exo2.className}`}>
                DENSITY MODE (RESOLUTION):
              </label>
              <Dropdown.Root>
                <AriaButton className={`w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-sm text-white flex justify-between items-center text-left focus:outline-none focus:border-emerald-500 standard-select-ui ${exo2.className}`}>
                  {printSettings.printMode === "draft" && "Draft Density (300dpi / Fast)"}
                  {printSettings.printMode === "standard" && "Standard Execution Layer (600dpi)"}
                  {printSettings.printMode === "high" && "High Fidelity Matrix (1200dpi)"}
                </AriaButton>
                <Dropdown.Popover className="bg-zinc-900 border border-zinc-800 rounded mt-1 shadow-xl p-1 w-[340px] z-50">
                  <Dropdown.Menu className="outline-none w-full">
                    <Dropdown.Item onClick={() => handleOptionSelect("printMode", "draft")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Draft Density (300dpi / Fast)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("printMode", "standard")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Standard Execution Layer (600dpi)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("printMode", "high")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      High Fidelity Matrix (1200dpi)
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.Root>
            </div>

            {/* Chromatic Profile Dropdown */}
            <div>
              <label className={`block text-sm font-semibold tracking-wider text-zinc-400 mb-2 text-emerald-400 ${exo2.className}`}>
                CHROMATIC PROFILE:
              </label>
              <Dropdown.Root>
                <AriaButton className={`w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-sm text-white flex justify-between items-center text-left focus:outline-none focus:border-emerald-500 standard-select-ui ${exo2.className}`}>
                  {printSettings.colorMode === "color" && "Full Chromatic Scale Color"}
                  {printSettings.colorMode === "mono" && "Monochrome / Grayscale Array"}
                </AriaButton>
                <Dropdown.Popover className="bg-zinc-900 border border-zinc-800 rounded mt-1 shadow-xl p-1 w-[340px] z-50">
                  <Dropdown.Menu className="outline-none w-full">
                    <Dropdown.Item onClick={() => handleOptionSelect("colorMode", "color")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Full Chromatic Scale Color
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("colorMode", "mono")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Monochrome / Grayscale Array
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.Root>
            </div>

            {/* Duplex Layout Dropdown */}
            <div>
              <label className={`block text-sm font-semibold tracking-wider text-zinc-400 mb-2 text-emerald-400 ${exo2.className}`}>
                DUPLEX STRUCTURAL LAYOUT:
              </label>
              <Dropdown.Root>
                <AriaButton className={`w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-sm text-white flex justify-between items-center text-left focus:outline-none focus:border-emerald-500 standard-select-ui ${exo2.className}`}>
                  {printSettings.duplexMode === "simplex" && "Simplex (Single Sided Layout)"}
                  {printSettings.duplexMode === "duplex" && "Duplex (Double Sided Long-Edge)"}
                </AriaButton>
                <Dropdown.Popover className="bg-zinc-900 border border-zinc-800 rounded mt-1 shadow-xl p-1 w-[340px] z-50">
                  <Dropdown.Menu className="outline-none w-full">
                    <Dropdown.Item onClick={() => handleOptionSelect("duplexMode", "simplex")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Simplex (Single Sided Layout)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("duplexMode", "duplex")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Duplex (Double Sided Long-Edge Binding)
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.Root>
            </div>

            {/* Page Mode Selector Dropdown */}
            <div>
              <label className={`block text-sm font-semibold tracking-wider text-zinc-400 mb-2 text-emerald-400 ${exo2.className}`}>
                PAGE RANGE OPTIONS:
              </label>
              <Dropdown.Root>
                <AriaButton className={`w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-sm text-white flex justify-between items-center text-left focus:outline-none focus:border-emerald-500 standard-select-ui ${exo2.className}`}>
                  {printSettings.pageMode === "all" ? "Print Complete Document (All Pages)" : "Custom Selection Range"}
                </AriaButton>
                <Dropdown.Popover className="bg-zinc-900 border border-zinc-800 rounded mt-1 shadow-xl p-1 w-[340px] z-50">
                  <Dropdown.Menu className="outline-none w-full">
                    <Dropdown.Item onClick={() => handleOptionSelect("pageMode", "all")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Print Complete Document (All Pages)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("pageMode", "custom")} className={`w-full text-left text-sm p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded cursor-pointer ${exo2.className}`}>
                      Custom Selection Range
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.Root>
            </div>

            {/* Conditional Sub-input: Mounts text field if custom mode matches */}
            {printSettings.pageMode === "custom" && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                <label className={`block text-xs font-semibold tracking-wider text-zinc-500 mb-1 font-mono`}>
                  ENTER PAGES (e.g., 1-5, 8, 11-13):
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., 1-4, 7, 9-11"
                  value={printSettings.customPages}
                  onChange={(e) => handleOptionSelect("customPages", e.target.value)}
                  className={`w-full bg-zinc-900 border border-zinc-700 rounded p-2 font-mono text-sm text-white focus:outline-none focus:border-emerald-500`}
                />
              </div>
            )}

          </div>

          {/* Action Dispatch Trigger Button */}
          <div className="pt-4">
            <RippleButton 
              type="submit" 
              disabled={isSubmitting}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white py-3 rounded font-mono font-bold tracking-widest transition-colors cursor-pointer"
            >
              {isSubmitting ? "PROCESSING EXECUTION QUEUE..." : "DISPATCH PRINT EXECUTION LOOP"}
            </RippleButton>
          </div>
        </div>
      </form>
    </div>
  );
};