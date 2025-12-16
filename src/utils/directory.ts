import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export async function findWorkflowDir(dir: string): Promise<string> {
  if (isAbsolute(dir)) {
    if (await directoryExists(dir)) {
      return dir;
    }
    throw new Error(`Workflow directory not found: ${dir}`);
  }

  const cwd = process.cwd();

  // Try current directory
  let path = join(cwd, dir);
  if (await directoryExists(path)) {
    return path;
  }

  // Try to find .github in parent directories
  let current = cwd;
  while (true) {
    path = join(current, ".github", "workflows");
    if (await directoryExists(path)) {
      return path;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(`Workflow directory not found: ${dir} (searched from ${cwd})`);
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
