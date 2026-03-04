/**
 * Spotidown download engine
 * Based on https://github.com/ferrymehdi/spotidown
 * 
 * Uses spotidown.app's HTTP API directly (no Puppeteer needed).
 * The key insight: search queries work without reCAPTCHA!
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { createJob, updateJob, getJob, deleteJob, type DownloadJob } from "./storage";
import JSZip from "jszip";

export const downloadsDir = path.resolve(process.cwd(), "downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

export interface SearchResult {
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  duration: string;
  spotifyId?: string;
  // spotidown form fields for download
  data: string;
  base: string;
  token: string;
}

interface SpotidownSession {
  cookies: string;
  tokenName: string;
  tokenValue: string;
}

async function getSpotidownSession(): Promise<SpotidownSession> {
  const res = await fetch("https://spotidown.app/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const html = await res.text();
  const cookieHeaders = (res.headers as any).getSetCookie
    ? (res.headers as any).getSetCookie()
    : [res.headers.get("set-cookie")];
  const cookies = cookieHeaders
    .filter(Boolean)
    .map((c: string) => c.split(";")[0])
    .join("; ");

  const tokenMatch = html.match(/<input name="(_[a-zA-Z0-9]+)" type="hidden" value="([^"]+)"/);
  const tokenName = tokenMatch?.[1] || "";
  const tokenValue = tokenMatch?.[2] || "";

  return { cookies, tokenName, tokenValue };
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Structure: each track occupies a "mb-3 grid-container" block which contains
  // both a "grid-item spotidown mb-10" div (with track info + album art)
  // and a "grid-item" div (with a form containing data/base/token fields)
  const containerPattern = /<div class="mb-3 grid-container">([\s\S]*?)<\/form>\s*<\/div>\s*<\/div>/g;
  let match;

  while ((match = containerPattern.exec(html)) !== null) {
    const block = match[1];

    // Extract album art (from Spotify CDN)
    const imgM = block.match(/src="(https:\/\/i\.scdn\.co[^"]+)"/);
    // Extract track name
    const nameM = block.match(/<h1 itemprop="name"><a[^>]+>([^<]+)<\/a><\/h1>/);
    // Extract artist
    const artistM = block.match(/<p><span>([^<]+)<\/span><\/p>/);
    // Get form data fields
    const dataM = block.match(/name="data" value='([^']+)'/);
    const baseM = block.match(/name="base" value="([^"]+)"/);
    const tokenM = block.match(/name="token" value="([^"]+)"/);

    if (dataM) {
      // Decode the JSON embedded in the data field for full track metadata
      let decoded: any = {};
      try {
        decoded = JSON.parse(Buffer.from(dataM[1], "base64").toString("utf8"));
      } catch (_) {}

      const name = decoded.name || nameM?.[1] || "Unknown";
      const artist = decoded.artist || artistM?.[1] || "Unknown Artist";

      results.push({
        name,
        artist,
        album: decoded.album || "",
        albumArt: decoded.cover || imgM?.[1] || "",
        duration: decoded.duration || "",
        spotifyId: decoded.tid,
        data: dataM[1],
        base: baseM?.[1] || "",
        token: tokenM?.[1] || "",
      });
    }
  }

  return results;
}

export async function searchSpotidown(query: string): Promise<SearchResult[]> {
  const session = await getSpotidownSession();

  const body = new URLSearchParams();
  body.append("url", query);
  body.append("g-recaptcha-response", "");
  if (session.tokenName) body.append(session.tokenName, session.tokenValue);

  const res = await fetch("https://spotidown.app/action", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cookie": session.cookies,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "https://spotidown.app/",
      "Origin": "https://spotidown.app",
    },
    body: body.toString(),
  });

  const json = await res.json() as any;
  if (json.error) throw new Error(json.message || "Search failed");

  return parseSearchResults(json.data as string);
}

export async function getDownloadUrl(
  data: string,
  base: string,
  token: string,
  sessionCookies?: string
): Promise<string> {
  // Get a fresh session if needed
  let cookies = sessionCookies;
  if (!cookies) {
    const session = await getSpotidownSession();
    cookies = session.cookies;
  }

  const body = new URLSearchParams();
  body.append("data", data);
  body.append("base", base);
  body.append("token", token);

  const res = await fetch("https://spotidown.app/action/track", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cookie": cookies,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "https://spotidown.app/",
      "Origin": "https://spotidown.app",
    },
    body: body.toString(),
  });

  const json = await res.json() as any;
  if (json.error) throw new Error(json.message || "Failed to get download URL");

  const urlMatch = (json.data as string).match(/href="(https:\/\/rapid\.spotidown\.app[^"]+)"/);
  if (!urlMatch) throw new Error("Could not extract download URL");

  return urlMatch[1];
}

export async function startDownload(
  name: string,
  artist: string,
  albumArt: string,
  _data: string,
  _base: string,
  _token: string
): Promise<string> {
  const jobId = randomUUID();

  createJob({
    id: jobId,
    trackId: `${name}-${artist}`.replace(/\s/g, "-").toLowerCase(),
    title: name,
    artist,
    albumArt,
    status: "pending",
    progress: 0,
    createdAt: Date.now(),
  });

  // Do a fresh search at download time so the session + token are always in sync
  setImmediate(() => runDownload(jobId, name, artist, albumArt));
  return jobId;
}

async function runDownload(
  jobId: string,
  name: string,
  artist: string,
  albumArt: string,
): Promise<void> {
  try {
    updateJob(jobId, { status: "downloading", progress: 5 });

    // Get a fresh session
    const session = await getSpotidownSession();
    updateJob(jobId, { progress: 10 });

    // Do a fresh search to get a token tied to this session
    const query = `${name} ${artist}`.trim();
    const body = new URLSearchParams();
    body.append("url", query);
    body.append("g-recaptcha-response", "");
    if (session.tokenName) body.append(session.tokenName, session.tokenValue);

    const searchRes = await fetch("https://spotidown.app/action", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": session.cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://spotidown.app/",
        "Origin": "https://spotidown.app",
      },
      body: body.toString(),
    });
    const searchJson = await searchRes.json() as any;
    if (searchJson.error) throw new Error(searchJson.message || "Re-search failed");

    const freshResults = parseSearchResults(searchJson.data as string);
    if (!freshResults.length) throw new Error("No results found for track. Try again.");

    const track = freshResults[0];
    updateJob(jobId, { progress: 15 });

    console.log(`[Downloader] Re-searched "${name}" → using fresh token for download`);

    // Get the rapid.spotidown.app download URL using the same session
    const downloadUrl = await getDownloadUrl(track.data, track.base, track.token, session.cookies);
    updateJob(jobId, { progress: 20 });

    console.log(`[Downloader] Got URL for "${name}": ${downloadUrl.slice(0, 80)}...`);

    // Download the file
    const safeFilename = `${artist} - ${name}`.replace(/[<>:"/\\|?*]/g, "").substring(0, 100);
    const filePath = path.join(downloadsDir, `${jobId}_${safeFilename}.mp3`);

    const fileRes = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://spotidown.app/",
      },
    });

    if (!fileRes.ok) {
      throw new Error(`Download failed: ${fileRes.status} ${fileRes.statusText}`);
    }

    const contentLength = parseInt(fileRes.headers.get("content-length") || "0");
    updateJob(jobId, { progress: 30 });

    // Stream to file
    const writeStream = fs.createWriteStream(filePath);
    const reader = (fileRes.body as any)?.getReader?.();

    if (reader) {
      let downloaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writeStream.write(Buffer.from(value));
        downloaded += value.length;
        if (contentLength > 0) {
          const pct = Math.round(30 + (downloaded / contentLength) * 68);
          updateJob(jobId, { progress: Math.min(pct, 98) });
        }
      }
      writeStream.end();
    } else {
      // Fallback: use buffer
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      writeStream.write(buffer);
      writeStream.end();
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    updateJob(jobId, { status: "completed", progress: 100, filePath, fileSize });
    console.log(`[Downloader] Done: "${name}" (${fileSize} bytes)`);
  } catch (err: any) {
    console.error(`[Downloader] Error for job ${jobId}:`, err.message);
    updateJob(jobId, { status: "error", error: err.message || "Download failed" });
  }
}

export async function startBulkDownload(results: SearchResult[]): Promise<string> {
  const jobId = randomUUID();
  
  createJob({
    id: jobId,
    trackId: "bulk-zip-" + Date.now(),
    title: "Music Bundle",
    artist: `${results.length} Tracks`,
    status: "pending",
    progress: 0,
    createdAt: Date.now(),
  });

  setImmediate(() => runBulkDownload(jobId, results));
  return jobId;
}

async function runBulkDownload(jobId: string, results: SearchResult[]): Promise<void> {
  try {
    updateJob(jobId, { status: "downloading", progress: 1 });
    const zip = new JSZip();
    const total = results.length;
    let completedCount = 0;

    for (const item of results) {
      try {
        const session = await getSpotidownSession();
        const query = `${item.name} ${item.artist}`.trim();
        const body = new URLSearchParams();
        body.append("url", query);
        body.append("g-recaptcha-response", "");
        if (session.tokenName) body.append(session.tokenName, session.tokenValue);

        const searchRes = await fetch("https://spotidown.app/action", {
          method: "POST",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Cookie": session.cookies,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://spotidown.app/",
          },
          body: body.toString(),
        });
        const searchJson = await searchRes.json() as any;
        if (searchJson.error) continue;

        const freshResults = parseSearchResults(searchJson.data as string);
        if (!freshResults.length) continue;

        const track = freshResults[0];
        const downloadUrl = await getDownloadUrl(track.data, track.base, track.token, session.cookies);

        const fileRes = await fetch(downloadUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://spotidown.app/",
          },
        });

        if (fileRes.ok) {
          const buffer = Buffer.from(await fileRes.arrayBuffer());
          const safeName = `${item.artist} - ${item.name}.mp3`.replace(/[<>:"/\\|?*]/g, "");
          zip.file(safeName, buffer);
        }
      } catch (e) {
        console.error(`[Bulk] Failed ${item.name}:`, e);
      }
      
      completedCount++;
      const pct = Math.round((completedCount / total) * 90);
      updateJob(jobId, { progress: pct });
    }

    updateJob(jobId, { progress: 95 });
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const filePath = path.join(downloadsDir, `${jobId}_bundle.zip`);
    fs.writeFileSync(filePath, zipBuffer);

    updateJob(jobId, { 
      status: "completed", 
      progress: 100, 
      filePath, 
      fileSize: zipBuffer.length 
    });
  } catch (err: any) {
    updateJob(jobId, { status: "error", error: err.message || "Bulk failed" });
  }
}
