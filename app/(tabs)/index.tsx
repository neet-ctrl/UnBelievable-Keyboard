import React, { useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable,
  FlatList, Image, ActivityIndicator, Platform, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, FadeIn,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import { saveLocalJob, downloadFileToInternalStorage } from "@/lib/storage";
import type { SearchResult, DownloadJob } from "@/types/spotify";
import { useRouter } from "expo-router";

const C = Colors.dark;

function TrackCard({ item, onDownload, isDownloading, index }: {
  item: SearchResult;
  onDownload: (item: SearchResult) => void;
  isDownloading: boolean;
  index: number;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View entering={FadeIn.duration(300)} style={[styles.card, { backgroundColor: C.surface }]}>
      <Text style={[styles.indexText, { color: C.textMuted }]}>{index + 1}</Text>
      {item.albumArt ? (
        <Image source={{ uri: item.albumArt }} style={styles.cardArt} />
      ) : (
        <View style={[styles.cardArt, styles.cardArtPlaceholder]}>
          <Ionicons name="musical-notes" size={24} color={C.textMuted} />
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.cardArtist, { color: C.textSecondary }]} numberOfLines={1}>{item.artist}</Text>
        {item.album ? (
          <Text style={[styles.cardAlbum, { color: C.textMuted }]} numberOfLines={1}>
            {item.album}{item.duration ? ` · ${item.duration}` : ""}
          </Text>
        ) : null}
      </View>
      <Animated.View style={animStyle}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDownload(item);
          }}
          onPressIn={() => { scale.value = withSpring(0.85); }}
          onPressOut={() => { scale.value = withSpring(1); }}
          disabled={isDownloading}
          style={[styles.dlBtn, { backgroundColor: isDownloading ? C.surface3 : C.tint }]}
        >
          {isDownloading
            ? <ActivityIndicator size={16} color={C.tint} />
            : <Ionicons name="arrow-down" size={18} color="#000" />
          }
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

export default function DownloadScreen() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [downloadingKeys, setDownloadingKeys] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

  const borderAnim = useSharedValue(0);
  const inputStyle = useAnimatedStyle(() => ({
    borderColor: withTiming(borderAnim.value === 1 ? C.tint : C.border, { duration: 200 }),
    shadowOpacity: withTiming(borderAnim.value === 1 ? 0.35 : 0, { duration: 200 }),
  }));

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setError(null);
    setResults([]);
    setSearched(true);

    try {
      const res = await apiRequest("POST", "/api/search", { query: q });
      const data = await res.json() as { results: SearchResult[] };
      setResults(data.results || []);
      if (!data.results?.length) setError("No results found. Try a different search.");
    } catch (err: any) {
      setError(err.message || "Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleDownload = useCallback(async (item: SearchResult) => {
    const key = `${item.name}-${item.artist}`;
    if (downloadingKeys.has(key)) return;
    setDownloadingKeys(prev => new Set(prev).add(key));

    try {
      const jobId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      const newJob: DownloadJob = {
        id: jobId,
        trackId: item.spotifyId || key,
        title: item.name,
        artist: item.artist,
        albumArt: item.albumArt,
        status: "downloading",
        progress: 0,
        createdAt: Date.now(),
      };
      await saveLocalJob(newJob);

      // 1. Get the actual download URL from the server
      const res = await apiRequest("POST", "/api/download-url", {
        data: item.data,
        base: item.base,
        token: item.token
      });
      const { downloadUrl } = await res.json();
      
      if (!downloadUrl) throw new Error("Could not get download URL");

      // 2. Download directly to phone storage
      await downloadFileToInternalStorage(downloadUrl, `${item.artist} - ${item.name}.mp3`, jobId);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push("/history");
    } catch (err: any) {
      Alert.alert("Download Failed", err.message || "Could not start download.");
    } finally {
      setDownloadingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [downloadingKeys, router]);

  const handleDownloadAll = useCallback(async () => {
    if (results.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setZipping(true);

    try {
      // 1. Ask the server to prepare a ZIP bundle
      const res = await apiRequest("POST", "/api/bulk-download-url", {
        results: results.map(item => ({
          data: item.data,
          base: item.base,
          token: item.token,
          name: item.name,
          artist: item.artist
        }))
      });
      const { downloadUrl } = await res.json();
      
      if (!downloadUrl) throw new Error("Could not prepare ZIP bundle");

      // 2. Download the ZIP directly to phone storage
      const jobId = "bulk-" + Date.now();
      const newJob: DownloadJob = {
        id: jobId,
        trackId: "bulk-zip",
        title: "Music Bundle",
        artist: `${results.length} Tracks`,
        status: "downloading",
        progress: 0,
        createdAt: Date.now(),
      };
      await saveLocalJob(newJob);

      await downloadFileToInternalStorage(downloadUrl, `SpotiDown_Bundle_${Date.now()}.zip`, jobId);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push("/history");
    } catch (err: any) {
      Alert.alert("Bulk Download Failed", err.message || "Could not start bulk download.");
    } finally {
      setZipping(false);
    }
  }, [results, router]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 60;

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <LinearGradient
        colors={["#0D2B1A", "#0F1F14", "#0A0A0A"]}
        style={[styles.header, { paddingTop: topPad + 16 }]}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.appName}>SpotiDown</Text>
            <Text style={styles.appSub}>Powered by spotidown.app</Text>
          </View>
          <View style={styles.logoWrap}>
            <MaterialCommunityIcons name="spotify" size={26} color={C.tint} />
          </View>
        </View>

        <Animated.View style={[styles.searchRow, inputStyle, { backgroundColor: C.surface2, borderColor: C.border }]}>
          <Ionicons name="search" size={18} color={C.textMuted} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: C.text }]}
            placeholder="Search track name or artist..."
            placeholderTextColor={C.textMuted}
            value={query}
            onChangeText={setQuery}
            onFocus={() => { borderAnim.value = 1; }}
            onBlur={() => { borderAnim.value = 0; }}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(""); setResults([]); setSearched(false); setError(null); }}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </Animated.View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={handleSearch}
            disabled={loading || !query.trim()}
            style={({ pressed }) => [
              styles.searchBtn,
              { backgroundColor: C.tint, opacity: pressed || !query.trim() ? 0.7 : 1 },
              results.length > 0 && { flex: 1, marginRight: 8 }
            ]}
          >
            {loading
              ? <ActivityIndicator size={16} color="#000" />
              : <Text style={styles.searchBtnText}>Search</Text>
            }
          </Pressable>

          {results.length > 0 && (
            <Pressable
              onPress={handleDownloadAll}
              disabled={zipping}
              style={({ pressed }) => [
                styles.searchBtn,
                { backgroundColor: C.surface3, opacity: pressed || zipping ? 0.7 : 1, flex: 1 }
              ]}
            >
              {zipping ? (
                <ActivityIndicator size={16} color={C.text} />
              ) : (
                <Text style={[styles.searchBtnText, { color: C.text }]}>Download All</Text>
              )}
            </Pressable>
          )}
        </View>

        <Text style={styles.hintText}>
          Search by song name, artist, or "artist - song"
        </Text>
      </LinearGradient>

      <FlatList
        data={results}
        keyExtractor={(item, idx) => `${item.name}-${item.artist}-${idx}`}
        renderItem={({ item, index }) => (
          <TrackCard
            item={item}
            index={index}
            onDownload={handleDownload}
            isDownloading={downloadingKeys.has(`${item.name}-${item.artist}`)}
          />
        )}
        contentContainerStyle={[
          styles.list,
          results.length === 0 && styles.emptyList,
          { paddingBottom: bottomPad },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={results.length > 0}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.empty}>
            {!searched ? (
              <>
                <View style={[styles.emptyIcon, { backgroundColor: C.surface2 }]}>
                  <MaterialCommunityIcons name="music-note-bluetooth" size={44} color={C.tint} />
                </View>
                <Text style={[styles.emptyTitle, { color: C.text }]}>Find & Download Music</Text>
                <Text style={[styles.emptyDesc, { color: C.textSecondary }]}>
                  Search for any song by name or artist. Download as MP3 directly to your device.
                </Text>
                <View style={[styles.exBox, { backgroundColor: C.surface }]}>
                  <Text style={[styles.exLabel, { color: C.textMuted }]}>Example searches:</Text>
                  {["Shape of You Ed Sheeran", "Blinding Lights The Weeknd", "Levitating Dua Lipa"].map(ex => (
                    <Pressable key={ex} onPress={() => { setQuery(ex); inputRef.current?.focus(); }}>
                      <Text style={[styles.exItem, { color: C.textSecondary }]}>→  {ex}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : loading ? (
              <ActivityIndicator size={40} color={C.tint} style={{ marginTop: 40 }} />
            ) : error ? (
              <>
                <View style={[styles.emptyIcon, { backgroundColor: "#2D1515" }]}>
                  <Ionicons name="alert-circle" size={40} color={C.error} />
                </View>
                <Text style={[styles.emptyTitle, { color: C.text }]}>No Results</Text>
                <Text style={[styles.emptyDesc, { color: C.textSecondary }]}>{error}</Text>
              </>
            ) : null}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  appName: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFF", letterSpacing: -0.5 },
  appSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  logoWrap: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: "#1DB95420", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#1DB95440",
  },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 13,
    shadowColor: "#1DB954", shadowOffset: { width: 0, height: 0 }, shadowRadius: 10,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  actionRow: { flexDirection: "row", marginBottom: 10 },
  searchBtn: {
    borderRadius: 12, paddingVertical: 13,
    alignItems: "center", justifyContent: "center",
  },
  searchBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
  hintText: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
  list: { paddingHorizontal: 16, paddingTop: 16 },
  emptyList: { flex: 1 },
  card: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, padding: 12, marginBottom: 8, gap: 12,
  },
  indexText: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 20, textAlign: "center" },
  cardArt: { width: 54, height: 54, borderRadius: 8 },
  cardArtPlaceholder: {
    backgroundColor: C.surface3, alignItems: "center", justifyContent: "center",
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  cardArtist: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 2 },
  cardAlbum: { fontSize: 11, fontFamily: "Inter_400Regular" },
  dlBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  emptyTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 10, textAlign: "center" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 28 },
  exBox: { width: "100%", borderRadius: 14, padding: 16, gap: 10 },
  exLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  exItem: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
