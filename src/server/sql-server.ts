import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | undefined;
let localEnvLoaded = false;

function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function applyEnvFile(content: string): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = stripEnvQuotes(line.slice(separatorIndex + 1));
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

async function loadLocalEnvFiles(): Promise<void> {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  if (typeof process === "undefined" || typeof process.cwd !== "function") return;

  try {
    const [{ readFile }, { resolve }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);

    for (const filename of [".env.local", ".env"]) {
      try {
        const content = await readFile(resolve(process.cwd(), filename), "utf8");
        applyEnvFile(content);
      } catch {
        // Missing local env files are fine; production should provide real environment variables.
      }
    }
  } catch {
    // Non-Node runtimes cannot read local files; they must provide process.env directly.
  }
}

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function readBooleanEnv(names: string[], fallback: boolean): boolean {
  const value = readEnv(...names).toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "sim"].includes(value);
}

function readNumberEnv(names: string[], fallback: number): number {
  const value = Number(readEnv(...names));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function createSqlConfig(): sql.config {
  const server = readEnv("SQLSERVER_HOST", "AZURE_SQL_SERVER");
  const database = readEnv("SQLSERVER_DATABASE", "AZURE_SQL_DATABASE");
  const user = readEnv("SQLSERVER_USER", "AZURE_SQL_USER");
  const password = readEnv("SQLSERVER_PASSWORD", "AZURE_SQL_PASSWORD");

  if (!server || !database || !user || !password) {
    throw new Error(
      "Configure SQLSERVER_* ou AZURE_SQL_* no .env.local para conectar ao SQL Server.",
    );
  }

  return {
    server,
    database,
    user,
    password,
    port: readNumberEnv(["SQLSERVER_PORT", "AZURE_SQL_PORT"], 1433),
    pool: {
      max: readNumberEnv(["SQLSERVER_POOL_MAX", "AZURE_SQL_POOL_MAX"], 10),
      min: readNumberEnv(["SQLSERVER_POOL_MIN", "AZURE_SQL_POOL_MIN"], 0),
      idleTimeoutMillis: readNumberEnv(["SQLSERVER_POOL_IDLE_MS", "AZURE_SQL_POOL_IDLE_MS"], 30000),
    },
    options: {
      encrypt: readBooleanEnv(["SQLSERVER_ENCRYPT", "AZURE_SQL_ENCRYPT"], false),
      trustServerCertificate: readBooleanEnv(
        ["SQLSERVER_TRUST_CERTIFICATE", "AZURE_SQL_TRUST_SERVER_CERT"],
        true,
      ),
    },
  };
}

export async function getSqlPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    await loadLocalEnvFiles();

    const pool = new sql.ConnectionPool(createSqlConfig());
    pool.on("error", (error) => {
      console.error("SQL Server pool error", error);
      poolPromise = undefined;
    });

    poolPromise = pool.connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }

  return poolPromise;
}
