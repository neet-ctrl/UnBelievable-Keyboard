export interface SearchResult {
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  duration: string;
  spotifyId?: string;
  data: string;
  base: string;
  token: string;
}

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
