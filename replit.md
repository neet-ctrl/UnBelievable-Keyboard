# App Configuration

This app is designed to be a self-contained APK and Web application.

## Local Storage
The app uses `@react-native-async-storage/async-storage` for data persistence, ensuring it works offline without a backend server.
- See `lib/storage.ts` for the implementation.

## Native Features
Native Android permissions and features (Storage, Sharing, Media Library) are handled via Expo modules:
- `expo-file-system`
- `expo-sharing`
- `expo-media-library`
- Implementation found in `lib/files.ts`.

## Build Process
To build the APK:
1. Ensure you have an Expo account and `eas-cli` installed.
2. Run `eas build -p android --profile preview` to generate an APK.
3. For GitHub Actions, use the `expo/expo-github-action` in your workflow.
