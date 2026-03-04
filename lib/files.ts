import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

export const fileService = {
  async downloadFile(url: string, fileName: string) {
    if (Platform.OS === 'web') {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      return;
    }

    const fileUri = FileSystem.documentDirectory + fileName;
    const downloadResumable = FileSystem.createDownloadResumable(url, fileUri);

    try {
      const result = await downloadResumable.downloadAsync();
      if (result) {
        return result.uri;
      }
    } catch (e) {
      console.error('Error downloading file', e);
    }
  },

  async shareFile(fileUri: string) {
    if (Platform.OS === 'web') {
      console.warn('Sharing is not supported on web');
      return;
    }

    if (!(await Sharing.isAvailableAsync())) {
      alert(`Sharing isn't available on your platform`);
      return;
    }

    await Sharing.shareAsync(fileUri);
  },

  async saveToGallery(fileUri: string) {
    if (Platform.OS === 'web') {
       console.warn('Saving to gallery is not supported on web');
       return;
    }

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      await MediaLibrary.createAssetAsync(fileUri);
      alert('Saved to gallery!');
    }
  }
};
