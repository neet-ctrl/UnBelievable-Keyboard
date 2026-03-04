export interface DownloadJob {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  albumArt?: string;
  status: "pending" | "downloading" | "completed" | "error";
  progress: number;
  filePath?: string;
  fileSize?: number;
  error?: string;
  createdAt: number;
}

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArt?: string;
  duration: number;
  spotifyUrl: string;
  previewUrl?: string;
}

export interface PlaylistInfo {
  id: string;
  name: string;
  description: string;
  coverArt?: string;
  tracks: TrackInfo[];
  total: number;
  spotifyUrl: string;
}

const jobs = new Map<string, DownloadJob>();
const MAX_JOBS = 50;

export function createJob(job: DownloadJob): DownloadJob {
  if (jobs.size >= MAX_JOBS) {
    const oldest = Array.from(jobs.values()).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) jobs.delete(oldest.id);
  }
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): DownloadJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, updates: Partial<DownloadJob>): DownloadJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  const updated = { ...job, ...updates };
  jobs.set(id, updated);
  return updated;
}

export function getAllJobs(): DownloadJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteJob(id: string): boolean {
  return jobs.delete(id);
}
