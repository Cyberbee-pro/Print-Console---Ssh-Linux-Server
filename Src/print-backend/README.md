# Print Console Backend

The backend gateway for the Print Console application, powered by Express and running on the [Bun](https://bun.sh) runtime. It serves as an API that accepts document file uploads from the frontend and stages/routes them directly to a local or remote (SSH) print pipeline.

---

## Getting Started

### Install Dependencies
Run the install command inside the backend workspace folder:
```bash
bun install
```

### Run in Development Mode
Execute the server using the Bun runtime:
```bash
bun run index.ts
```

---

## Configuration & Environment Variables

Create a `.env.local` file (or `.env` file) inside `Src/print-backend/` based on the configuration keys documented below.

### 1. Express Server Network Settings
* **`PORT`** (Default: `5000`): The local port number on which the Express server listens.
* **`FRONTEND_ORIGIN`** / **`Frontend_Origin`** (Default: `"http://localhost:3000"`): The origin of the Next.js Frontend client application. Used to configure CORS whitelist policies.

### 2. Execution Mode Selection
The backend supports two main operational architectures: **Self-Hosted (Local)** mode and **Remote SSH Ingress Gateway** mode.
* **`SELF_HOST`** (Default: `false`): Set to `true` to enable local execution. When active, all spooling, drop zones, and printer driver commands run directly on the local machine.
* **`SSH_ENABLED`** (Default: `true`): Set to `false` to disable remote SSH spooling.
> [!NOTE]
> Self-hosted execution is automatically activated if **`SELF_HOST` is `"true"` OR `SSH_ENABLED` is `"false"`**. If neither condition is met, the backend attempts to establish SSH connections to run print commands on a remote system.

### 3. Print Spooler Toggles & Driver Configurations
* **`MOCK_PRINT`** (Default: `false`): Set to `true` to enable mock spooling (virtualization). Instead of spooling to actual CUPS hardware using `lp`, it will execute a mock `echo` process. Extremely useful for local testing and developer integration.
* **`PrinterName`** (Default: System Default Printer): Specifies the target CUPS printer identifier. If set, print commands will specifically target this printer (e.g. `lp -d <PrinterName>`). If left blank or empty, spooling falls back to the host machine's system default printer.

### 4. Storage & Directory Routing
* **`useStorage`** (Default: `false`): Enables local persistent disk storage via `multer.diskStorage`. Set to `true` if hosting on persistent machines (VMs, cloud instances, homelabs). If set to `false` (suitable for serverless environments like Vercel), uploaded files are stored in-memory during processing.
* **`STORAGE_POOL`** / **`STORAGE_POOL_PATH`** (Default: `"/srv/PrintConsoleStorage"`): The parent directory path where the spooler archives will be automatically bootstrapped. This directory houses three subfolders:
  - `/received`: Holds the final archive of received document files.
  - `/queue`: Holds actively spooled document queue streams.
  - `/printed`: Stores archives of successfully printed files.
* **`DROP_ZONE_PATH`** (Default: `"/srv/PrintConsoleStorage/printConsole"`): The staging directory where raw document uploads are temporarily written to disk prior to print execution commands.

### 5. Remote SSH Gateway Configurations
*(Only loaded/required when **Self-Hosted Mode is NOT active**)*
* **`SSH_HOST`** / **`serverIp`**: The hostname or IP address of the target remote Linux spooler server.
* **`SSH_PORT`** / **`serverPort`** (Default: `22`): The SSH server port.
* **`SSH_USER`** / **`sshUsr`**: Username used to establish the remote SSH session.
* **`SSH_KEY_PATH`** / **`sshKey`**: The SSH private identity key. Can be configured as either:
  1. An absolute local file path pointing to your private key (e.g. `/home/user/.ssh/id_rsa`).
  2. The raw PEM encoded private key contents (wrapped in quotation marks).
