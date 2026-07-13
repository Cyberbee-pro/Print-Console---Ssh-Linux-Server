"use client";

import { Orbit, Exo_2, Pixelify_Sans} from 'next/font/google';
import DecryptedText from '@/components/DecryptedText';
import PixelSnow from '@/components/PixelSnow';
import { FileUpload } from "@/components/application/file-upload/file-upload-base";
import { useState, useRef, useEffect } from 'react';
import { RippleButton } from '@/components/ui/ripple-button';
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { sendPrintJobToServer, fetchPipelineStatus, type PipelineState, getBackendUrl } from '@/utils/api';
import { Button as AriaButton } from 'react-aria-components';

// 1. Structural Contracts for Type Safety
interface PrintOptions {
  printMode: "draft" | "standard" | "high";
  colorMode: "color" | "mono";
  duplexMode: "simplex" | "duplex" | "manual";
  pageMode: "all" | "custom";
  customPages: string;
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

const pixelify = Pixelify_Sans({
  subsets: ['latin'],
  weight: '400',
});

export default function Home() {
  return (
    <div className="relative bg-black min-h-screen overflow-y-auto">
      {/* <SmoothCursor /> */}
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
    </div>
  );
}

const Content = () => {
  // 1. State containers tracking queue, loading lock, and parameters
  const [uploadedFiles, setUploadedFiles] = useState<TrackedPrintJob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [printSettings, setPrintSettings] = useState<PrintOptions>({
    printMode: "high",
    colorMode: "color",
    duplexMode: "simplex",
    pageMode: "all",
    customPages: "",
  });

  // State controls for handling manual duplex interaction queues
  const [flipPromptJob, setFlipPromptJob] = useState<{ id: string; name: string } | null>(null);
  const flipResolverRef = useRef<(() => void) | null>(null);

  const [pipelineStatus, setPipelineStatus] = useState<PipelineState | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadPipelineStatus = async () => {
    try {
      const data = await fetchPipelineStatus();
      setPipelineStatus(data);
      setStatusError(null);
    } catch (err) {
      console.error("Failed to fetch pipeline status: ", err);
      setStatusError("Failed to synchronize with server spooler pipeline.");
    }
  };

  useEffect(() => {
    // Defer the initial load to run asynchronously in a microtask
    Promise.resolve().then(() => {
      loadPipelineStatus();
    });
    // Poll every 5 seconds for live status updates
    const interval = setInterval(loadPipelineStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleOptionSelect = <K extends keyof PrintOptions>(
    settingKey: K,
    selectedValue: PrintOptions[K]
  ) => {
    setPrintSettings((previousSettings) => ({
      ...previousSettings,
      [settingKey]: selectedValue,
    }));
  };

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

  // Helper utility to pause execution loops until user completes manual operations
  const waitForUserPageFlip = (jobId: string, fileName: string): Promise<void> => {
    setFlipPromptJob({ id: jobId, name: fileName });
    return new Promise((resolve) => {
      flipResolverRef.current = () => {
        setFlipPromptJob(null);
        resolve();
      };
    });
  };

  // 3. The Dispatch Engine: Multi-stage print loops
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
        // Dispatches pass 1 (Processes Odd page layouts if set to manual mode)
        const receipt = await sendPrintJobToServer(job.fileObject, printSettings);

        // Check if backend flagged an active manual operations hold state
        if (receipt && receipt.status === "holding") {
          setUploadedFiles((prev) =>
            prev.map((item) => (item.id === job.id ? { ...item, progress: 50 } : item))
          );

          // Suspend asynchronous sequence execution thread until user interacts with the UI panel
          await waitForUserPageFlip(job.id, job.name);

          // Update rendering to reflect initialization of phase 2
          setUploadedFiles((prev) =>
            prev.map((item) => (item.id === job.id ? { ...item, progress: 75 } : item))
          );
          

          // Fire continuation array variables directly to the root backend continuation endpoint
          const backendUrl = getBackendUrl();
          const continueResponse = await fetch(`${backendUrl}/print/continue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: receipt.filename,
              originalBody: receipt.originalBody,
            }),
          });

          if (!continueResponse.ok) {
            const errorText = await continueResponse.text();
            throw new Error(errorText || "Hardware even page finishing layer delivery failed.");
          }
        }

        // Job completed successfully
        setUploadedFiles((prev) =>
          prev.map((item) => (item.id === job.id ? { ...item, progress: 100 } : item))
        );
        loadPipelineStatus();
      } catch (error) {
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
    loadPipelineStatus();
    
  };

  return (
    <div className="flex flex-col p-6 min-h-screen justify-center max-w-4xl mx-auto w-full">
      
      {/* Dynamic Overlay Instruction Station for Manual Handshakes */}
      {flipPromptJob && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-lime-500/40 p-6 rounded-xl max-w-md w-full font-mono text-white text-left shadow-2xl shadow-amber-500/5 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-green-400 font-bold tracking-widest text-lg mb-2 flex items-center gap-2">
              ACTION REQUIRED: TRAY FEED HANDSHAKE
            </h3>
            <p className="text-sm text-zinc-300 mb-4 leading-relaxed">
              Odd pages for <span className="text-white font-semibold">{flipPromptJob.name}</span> have printed successfully.
            </p>
            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded text-xs text-green-200/80 mb-6 space-y-2 leading-normal">
              <p>1. Extract printed sheets from output bin without shifting internal orientation.</p>
              <p>2. Flip the stack 180 degrees (according to hardware alignment requirements).</p>
              <p>3. Re-insert sheets firmly inside your primary paper feeder tray.</p>
            </div>
            <button
              onClick={() => flipResolverRef.current?.()}
              className="w-full bg-lime-600 hover:bg-green-500 text-black font-bold py-2.5 rounded transition-colors tracking-wider text-sm cursor-pointer"
            >
              AUTHORIZE FINISHING PASS (EVEN PAGES)
            </button>
          </div>
        </div>
      )}

      <div className={`flex text-4xl md:text-5xl font-bold text-white mb-4 p-3 tracking-widest ${orbit.className}`}>
        <p className={`${pixelify.className} text-lime-400 text-8xl`}>&gt;</p>
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
        Manage your ssh print jobs with ease.
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
                    <Dropdown.Item onClick={() => handleOptionSelect("printMode", "draft")} className={exo2.className}>
                      Draft Density (300dpi / Fast)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("printMode", "standard")} className={exo2.className}>
                      Standard Execution Layer (600dpi)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("printMode", "high")} className={exo2.className}>
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
                    <Dropdown.Item onClick={() => handleOptionSelect("colorMode", "color")} className={exo2.className}>
                      Full Chromatic Scale Color
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("colorMode", "mono")} className={exo2.className}>
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
                  {printSettings.duplexMode === "manual" && "Manual Duplex (Two-Step Flip)"}
                </AriaButton>
                <Dropdown.Popover className="bg-zinc-900 border border-zinc-800 rounded mt-1 shadow-xl p-1 w-[340px] z-50">
                  <Dropdown.Menu className="outline-none w-full">
                    <Dropdown.Item onClick={() => handleOptionSelect("duplexMode", "simplex")} className={exo2.className}>
                      Simplex (Single Sided Layout)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("duplexMode", "duplex")} className={exo2.className}>
                      Duplex (Double Sided Long-Edge Binding)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("duplexMode", "manual")} className={exo2.className}>
                      Manual Duplex (Two-Step Flip Mode)
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
                    <Dropdown.Item onClick={() => handleOptionSelect("pageMode", "all")} className={exo2.className}>
                      Print Complete Document (All Pages)
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleOptionSelect("pageMode", "custom")} className={exo2.className}>
                      Custom Selection Range
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.Root>
            </div>

            {/* Conditional Sub-input for page mapping ranges */}
            {printSettings.pageMode === "custom" && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                <label className="block text-xs font-semibold tracking-wider text-zinc-500 mb-1 font-mono">
                  ENTER PAGES (e.g., 1-5, 8, 11-13):
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., 1-4, 7, 9-11"
                  value={printSettings.customPages}
                  onChange={(e) => handleOptionSelect("customPages", e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 font-mono text-sm text-white focus:outline-none focus:border-emerald-500"
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

      {/* Spooler Status Dashboard */}
      <div className={`mt-8 bg-zinc-950/80 border border-zinc-800 p-8 rounded-xl backdrop-blur-md text-white ${exo2.className}`}>
        <h3 className={`text-xl font-bold tracking-widest text-emerald-400 mb-6 uppercase ${orbit.className}`}>
          Server Spooler Pipeline
        </h3>

        {statusError ? (
          <div className="text-zinc-500 text-sm font-mono">{statusError}</div>
        ) : !pipelineStatus ? (
          <div className="text-zinc-500 text-sm font-mono animate-pulse">Syncing spooler matrix...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Received Stage Card */}
            <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-lg flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold tracking-wider text-zinc-400 uppercase">Received Dropped</span>
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
                </div>
                <div className="text-3xl font-extrabold text-blue-400 mb-4">{pipelineStatus.received?.count || 0}</div>
              </div>
              <div className="text-xs text-zinc-500 font-mono truncate">
                {pipelineStatus.received?.files && pipelineStatus.received.files.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside">
                    {pipelineStatus.received.files.slice(0, 3).map((f, i) => (
                      <li key={i} className="truncate" title={f}>{f}</li>
                    ))}
                    {pipelineStatus.received.files.length > 3 && (
                      <li className="list-none text-zinc-600">+{pipelineStatus.received.files.length - 3} more...</li>
                    )}
                  </ul>
                ) : (
                  "No files staged"
                )}
              </div>
            </div>

            {/* Active Queue Card */}
            <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-lg flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold tracking-wider text-zinc-400 uppercase">Printing Queue</span>
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                </div>
                <div className="text-3xl font-extrabold text-amber-400 mb-4">{pipelineStatus.queue?.count || 0}</div>
              </div>
              <div className="text-xs text-zinc-500 font-mono truncate">
                {pipelineStatus.queue?.files && pipelineStatus.queue.files.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside">
                    {pipelineStatus.queue.files.slice(0, 3).map((f, i) => (
                      <li key={i} className="truncate text-amber-200/70" title={f}>{f}</li>
                    ))}
                    {pipelineStatus.queue.files.length > 3 && (
                      <li className="list-none text-zinc-600">+{pipelineStatus.queue.files.length - 3} more...</li>
                    )}
                  </ul>
                ) : (
                  "Queue idle"
                )}
              </div>
            </div>

            {/* Printed Archive Card */}
            <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-lg flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold tracking-wider text-zinc-400 uppercase">Printed Archive</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                </div>
                <div className="text-3xl font-extrabold text-emerald-400 mb-4">{pipelineStatus.printed?.count || 0}</div>
              </div>
              <div className="text-xs text-zinc-500 font-mono truncate">
                {pipelineStatus.printed?.files && pipelineStatus.printed.files.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside">
                    {pipelineStatus.printed.files.slice(0, 3).map((f, i) => (
                      <li key={i} className="truncate text-zinc-400" title={f}>{f}</li>
                    ))}
                    {pipelineStatus.printed.files.length > 3 && (
                      <li className="list-none text-zinc-600">+{pipelineStatus.printed.files.length - 3} more...</li>
                    )}
                  </ul>
                ) : (
                  "No printed history"
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};