import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import * as fs from "fs";
import { searchSpotidown, startDownload, startBulkDownload, downloadsDir, getDownloadUrl, type SearchResult } from "./downloader";
import { getJob, getAllJobs, deleteJob } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", downloadsDir });
  });

  app.post("/api/search", async (req: Request, res: Response) => {
    const { query } = req.body as { query?: string };
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "query is required" });
    }
    try {
      const results = await searchSpotidown(query.trim());
      return res.json({ results });
    } catch (err: any) {
      console.error("Search error:", err);
      return res.status(500).json({ error: err.message || "Search failed" });
    }
  });

  app.post("/api/download-url", async (req: Request, res: Response) => {
    const { data, base, token } = req.body as {
      data?: string;
      base?: string;
      token?: string;
    };

    if (!data || !base || !token) {
      return res.status(400).json({ error: "data, base, and token are required" });
    }

    try {
      const downloadUrl = await getDownloadUrl(data, base, token);
      return res.json({ downloadUrl });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bulk-download-url", async (req: Request, res: Response) => {
    const { results } = req.body as { results: SearchResult[] };
    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: "No tracks selected" });
    }

    try {
      const jobId = await startBulkDownload(results);
      // We return the local download link for the ZIP
      const downloadUrl = `${req.protocol}://${req.get("host")}/api/download-file/${jobId}`;
      return res.json({ downloadUrl });
    } catch (err: any) {
      console.error("[BulkDownload] Error:", err);
      res.status(500).json({ error: "Failed to start bulk download" });
    }
  });

  app.post("/api/download", async (req: Request, res: Response) => {
    const { name, artist, albumArt, data, base, token } = req.body as {
      name?: string;
      artist?: string;
      albumArt?: string;
      data?: string;
      base?: string;
      token?: string;
    };

    if (!name || !artist || !data) {
      return res.status(400).json({ error: "name, artist, and data are required" });
    }

    try {
      const jobId = await startDownload(
        name,
        artist,
        albumArt || "",
        data,
        base || "",
        token || ""
      );
      const job = getJob(jobId);
      return res.json({ jobId, job });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/jobs", (_req: Request, res: Response) => {
    res.json(getAllJobs());
  });

  app.get("/api/jobs/:id", (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  app.delete("/api/jobs/:id", (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    if (job?.filePath && fs.existsSync(job.filePath)) {
      try { fs.unlinkSync(job.filePath); } catch (_) {}
    }
    deleteJob(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/download-file/:id", (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "completed" || !job.filePath) {
      return res.status(400).json({ error: "File not ready" });
    }
    if (!fs.existsSync(job.filePath)) {
      return res.status(404).json({ error: "File not found on disk" });
    }
    const isZip = job.filePath.endsWith(".zip");
    const filename = encodeURIComponent(isZip ? "spotidown_bundle.zip" : `${job.artist} - ${job.title}.mp3`);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
    res.setHeader("Content-Type", isZip ? "application/zip" : "audio/mpeg");
    fs.createReadStream(job.filePath).pipe(res);
  });

  app.post("/api/bulk-download", async (req: Request, res: Response) => {
    const { results } = req.body as { results: SearchResult[] };
    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: "No tracks selected" });
    }

    try {
      const jobId = await startBulkDownload(results);
      return res.json({ jobId });
    } catch (err: any) {
      console.error("[BulkDownload] Error:", err);
      res.status(500).json({ error: "Failed to start bulk download" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
