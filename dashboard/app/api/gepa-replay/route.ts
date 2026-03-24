import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const GEPA_LOGS = path.join(PROJECT_ROOT, "gepa_logs");
const EXTRACTOR = path.join(PROJECT_ROOT, "src", "extract_gepa_state.py");

function listBinFiles(): { run_id: string; path: string; size: number; mtime: number }[] {
  if (!fs.existsSync(GEPA_LOGS)) return [];
  const results: { run_id: string; path: string; size: number; mtime: number }[] = [];
  for (const dir of fs.readdirSync(GEPA_LOGS)) {
    const binPath = path.join(GEPA_LOGS, dir, "gepa_state.bin");
    if (fs.existsSync(binPath)) {
      const stat = fs.statSync(binPath);
      results.push({
        run_id: dir,
        path: binPath,
        size: stat.size,
        mtime: stat.mtimeMs / 1000,
      });
    }
  }
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

function extractBinData(binPath: string): unknown {
  // Check for cached JSON next to the bin file
  const cachePath = binPath.replace(".bin", ".replay.json");
  const binStat = fs.statSync(binPath);
  if (fs.existsSync(cachePath)) {
    const cacheStat = fs.statSync(cachePath);
    if (cacheStat.mtimeMs > binStat.mtimeMs) {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    }
  }

  // Run Python extractor
  const python = path.join(PROJECT_ROOT, ".venv", "bin", "python3");
  const pythonBin = fs.existsSync(python) ? python : "python3";
  const result = execSync(`${pythonBin} ${EXTRACTOR} "${binPath}"`, {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const data = JSON.parse(result.toString());

  // Cache the result
  fs.writeFileSync(cachePath, JSON.stringify(data));
  return data;
}

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("run_id");

  if (!runId) {
    // List available bin files
    const bins = listBinFiles();
    return NextResponse.json({ bins });
  }

  // Extract data for a specific run
  const binPath = path.join(GEPA_LOGS, runId, "gepa_state.bin");
  if (!fs.existsSync(binPath)) {
    return NextResponse.json({ error: "Bin file not found" }, { status: 404 });
  }

  try {
    const data = extractBinData(binPath);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
