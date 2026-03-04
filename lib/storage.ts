import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';

export const storage = {
  async set(key: string, value: any) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Error saving to storage', e);
    }
  },
  async get(key: string) {
    try {
      const value = await AsyncStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (e) {
      console.error('Error reading from storage', e);
      return null;
    }
  },
  async remove(key: string) {
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
      console.error('Error removing from storage', e);
    }
  }
};

const JOBS_KEY = 'spotidown_jobs';

export async function getLocalJobs() {
  return (await storage.get(JOBS_KEY)) || [];
}

export async function saveLocalJob(job: any) {
  const jobs = await getLocalJobs();
  const index = jobs.findIndex((j: any) => j.id === job.id);
  if (index >= 0) {
    jobs[index] = job;
  } else {
    jobs.push(job);
  }
  await storage.set(JOBS_KEY, jobs);
}

export async function deleteLocalJob(id: string) {
  const jobs = await getLocalJobs();
  const filtered = jobs.filter((j: any) => j.id !== id);
  await storage.set(JOBS_KEY, filtered);
}

export async function requestPermissions() {
  if (Platform.OS === 'android') {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'We need storage permissions to save music to your phone.');
      return false;
    }
  }
  return true;
}

export async function downloadFileToInternalStorage(url: string, fileName: string, jobId: string, onProgress?: (p: number) => void) {
  try {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const fileUri = FileSystem.documentDirectory + fileName;
    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      fileUri,
      {},
      (downloadProgress) => {
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        if (onProgress) onProgress(progress * 100);
      }
    );

    const result = await downloadResumable.downloadAsync();
    if (result) {
      const asset = await MediaLibrary.createAssetAsync(result.uri);
      await MediaLibrary.createAlbumAsync('SpotiDown', asset, false);
      
      const jobs = await getLocalJobs();
      const job = jobs.find((j: any) => j.id === jobId);
      if (job) {
        job.status = 'completed';
        job.filePath = result.uri;
        await saveLocalJob(job);
      }
      return result.uri;
    }
  } catch (e) {
    console.error('Download error:', e);
    const jobs = await getLocalJobs();
    const job = jobs.find((j: any) => j.id === jobId);
    if (job) {
      job.status = 'error';
      job.error = String(e);
      await saveLocalJob(job);
    }
    throw e;
  }
}
