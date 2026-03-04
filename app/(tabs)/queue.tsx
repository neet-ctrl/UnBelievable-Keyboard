import React, { useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, Image, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import type { DownloadJob } from "@/types/spotify";

const C = Colors.dark;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PulsingDot() {
  const opacity = useSharedValue(1);
  React.useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.2, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1, true
    );
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, { backgroundColor: C.tint }, style]} />;
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={[styles.progressBg, { backgroundColor: C.surface3 }]}>
      <View style={[styles.progressFill, { width: `${Math.min(progress, 100)}%`, backgroundColor: C.tint }]} />
    </View>
  );
}

function StatusBadge({ status }: { status: DownloadJob["status"] }) {
  const map = {
    pending: { bg: C.warning + "22", color: C.warning, label: "Pending", icon: "time-outline" as const },
    downloading: { bg: C.tint + "22", color: C.tint, label: "Processing", icon: "cloud-download-outline" as const },
    completed: { bg: C.tint + "22", color: C.tint, label: "Ready", icon: "checkmark-circle" as const },
    error: { bg: C.error + "22", color: C.error, label: "Failed", icon: "alert-circle-outline" as const },
  };
  const cfg = map[status] || map.pending;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon} size={11} color={cfg.color} />
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function JobCard({ job, onDelete }: { job: DownloadJob; onDelete: (id: string) => void }) {
  const isActive = job.status === "pending" || job.status === "downloading";
  const isZip = job.trackId.startsWith("bulk-zip-");

  const handleDownloadFile = () => {
    if (job.status !== "completed") return;
    const url = new URL(`/api/download-file/${job.id}`, getApiUrl()).toString();
    if (Platform.OS === "web") {
      window.location.href = url;
    } else {
      // For mobile, standard download link
      Alert.alert("Download Ready", "Your file is ready to download.");
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: C.surface }]}>
      <View style={styles.cardRow}>
        {job.albumArt ? (
          <Image source={{ uri: job.albumArt }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Ionicons name={isZip ? "archive" : "musical-note"} size={20} color={C.textMuted} />
          </View>
        )}
        <View style={styles.info}>
          <View style={styles.topRow}>
            <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{job.title}</Text>
            {isActive && <PulsingDot />}
          </View>
          <Text style={[styles.artist, { color: C.textSecondary }]} numberOfLines={1}>{job.artist}</Text>
          <View style={styles.metaRow}>
            <StatusBadge status={job.status} />
            {job.fileSize ? (
              <Text style={[styles.meta, { color: C.textMuted }]}>{formatBytes(job.fileSize)}</Text>
            ) : null}
          </View>
          {job.error ? (
            <Text style={[styles.errorText, { color: C.error }]} numberOfLines={2}>{job.error}</Text>
          ) : null}
        </View>
        <View style={styles.actions}>
          {job.status === "completed" && (
            <Pressable onPress={handleDownloadFile} style={styles.downloadBtn}>
              <Ionicons name="download-outline" size={20} color={C.tint} />
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDelete(job.id);
            }}
            style={styles.deleteBtn}
          >
            <Ionicons name="trash-outline" size={18} color={C.textMuted} />
          </Pressable>
        </View>
      </View>
      {isActive && (
        <View style={styles.progressWrap}>
          <ProgressBar progress={job.progress} />
          <View style={styles.progressLabels}>
            <Text style={[styles.progressType, { color: C.textMuted }]}>
              {isZip ? "Zipping bundle..." : "Downloading track..."}
            </Text>
            <Text style={[styles.progressText, { color: C.textMuted }]}>{job.progress}%</Text>
          </View>
        </View>
      )}
    </View>
  );
}

export default function QueueScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 60;

  const { data: jobs = [] } = useQuery<DownloadJob[]>({
    queryKey: ["/api/jobs"],
    refetchInterval: 1500,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/jobs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/jobs"] }),
  });

  const handleDelete = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const activeCount = jobs.filter(j => j.status === "pending" || j.status === "downloading").length;

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 20 }]}>
        <Text style={styles.headerTitle}>Queue</Text>
        {activeCount > 0 && (
          <View style={[styles.countBadge, { backgroundColor: C.tint }]}>
            <Text style={styles.countText}>{activeCount}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={jobs}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <JobCard job={item} onDelete={handleDelete} />}
        contentContainerStyle={[
          styles.list,
          jobs.length === 0 && styles.emptyList,
          { paddingBottom: bottomPad },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={jobs.length > 0}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: C.surface2 }]}>
              <Ionicons name="cloud-download-outline" size={40} color={C.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: C.text }]}>Queue is empty</Text>
            <Text style={[styles.emptyDesc, { color: C.textSecondary }]}>
              Search for a track and tap the download button to add it here
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20, paddingBottom: 16,
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  headerTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  countBadge: {
    minWidth: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  },
  countText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#000" },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  emptyList: { flex: 1 },
  card: { borderRadius: 14, padding: 14, marginBottom: 8 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  art: { width: 50, height: 50, borderRadius: 8 },
  artPlaceholder: { backgroundColor: C.surface3, alignItems: "center", justifyContent: "center" },
  info: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  artist: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },
  actions: { flexDirection: "row", alignItems: "center" },
  downloadBtn: { padding: 8, marginRight: 4 },
  deleteBtn: { padding: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  progressWrap: { marginTop: 12, gap: 6 },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  progressLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressType: { fontSize: 10, fontFamily: "Inter_500Medium" },
  progressText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 10 },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
