import React, { useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable,
  Image, Platform, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { getLocalJobs, deleteLocalJob } from "@/lib/storage";
import * as Sharing from 'expo-sharing';
import type { DownloadJob } from "@/types/spotify";
import { getApiUrl } from "@/lib/query-client";

const C = Colors.dark;

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now.getTime() - ts) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function HistoryCard({ job, onDelete, onDownload }: {
  job: DownloadJob;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const isSuccess = job.status === "completed";
  const isFailed = job.status === "error";

  return (
    <Animated.View entering={FadeIn.duration(250)} style={[styles.card, { backgroundColor: C.surface }]}>
      <View style={styles.cardRow}>
        {job.albumArt ? (
          <Image source={{ uri: job.albumArt }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Ionicons name="musical-note" size={20} color={C.textMuted} />
          </View>
        )}
        <View style={styles.info}>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{job.title}</Text>
          <Text style={[styles.artist, { color: C.textSecondary }]} numberOfLines={1}>{job.artist}</Text>
          <View style={styles.metaRow}>
            {isSuccess ? (
              <View style={[styles.badge, { backgroundColor: C.tint + "22" }]}>
                <Ionicons name="checkmark-circle" size={11} color={C.tint} />
                <Text style={[styles.badgeText, { color: C.tint }]}>Downloaded</Text>
              </View>
            ) : isFailed ? (
              <View style={[styles.badge, { backgroundColor: C.error + "22" }]}>
                <Ionicons name="close-circle" size={11} color={C.error} />
                <Text style={[styles.badgeText, { color: C.error }]}>Failed</Text>
              </View>
            ) : (
              <View style={[styles.badge, { backgroundColor: C.warning + "22" }]}>
                <Ionicons name="time-outline" size={11} color={C.warning} />
                <Text style={[styles.badgeText, { color: C.warning }]}>{job.status}</Text>
              </View>
            )}
            {job.fileSize ? (
              <Text style={[styles.meta, { color: C.textMuted }]}>{formatBytes(job.fileSize)}</Text>
            ) : null}
            <Text style={[styles.meta, { color: C.textMuted }]}>·</Text>
            <Text style={[styles.meta, { color: C.textMuted }]}>{formatDate(job.createdAt)}</Text>
          </View>
          {isFailed && job.error ? (
            <Text style={[styles.errorText, { color: C.error }]} numberOfLines={2}>{job.error}</Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          {isSuccess && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDownload(job.id);
              }}
              style={[styles.actionBtn, { backgroundColor: C.tint + "20" }]}
            >
              <Ionicons name="share-outline" size={18} color={C.tint} />
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDelete(job.id);
            }}
            style={[styles.actionBtn, { backgroundColor: C.surface3 }]}
          >
            <Ionicons name="trash-outline" size={18} color={C.textMuted} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 60;

  const { data: allJobs = [], refetch } = useQuery<DownloadJob[]>({
    queryKey: ["local-jobs"],
    queryFn: getLocalJobs,
    refetchInterval: 3000,
  });

  const handleDelete = useCallback(async (id: string) => {
    await deleteLocalJob(id);
    refetch();
  }, [refetch]);

  const handleDownload = useCallback(async (jobId: string) => {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;

    if (Platform.OS === "web") {
      const url = new URL(`/api/download-file/${job.id}`, getApiUrl());
      const a = document.createElement("a");
      a.href = url.toString();
      a.download = "";
      a.click();
    } else {
      if (job.filePath) {
        await Sharing.shareAsync(job.filePath);
      } else {
        Alert.alert("Error", "File path not found.");
      }
    }
  }, [allJobs]);

  const handleClearAll = useCallback(() => {
    Alert.alert(
      "Clear History",
      "This will remove all items from history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            for (const j of allJobs) {
              await deleteLocalJob(j.id);
            }
            refetch();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  }, [allJobs, refetch]);

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 20 }]}>
        <Text style={styles.headerTitle}>History</Text>
        {allJobs.length > 0 && (
          <Pressable onPress={handleClearAll} style={styles.clearBtn}>
            <Ionicons name="trash" size={16} color={C.textMuted} />
            <Text style={[styles.clearText, { color: C.textMuted }]}>Clear</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={allJobs}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <HistoryCard job={item} onDelete={handleDelete} onDownload={handleDownload} />
        )}
        contentContainerStyle={[
          styles.list,
          allJobs.length === 0 && styles.emptyList,
          { paddingBottom: bottomPad },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={allJobs.length > 0}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: C.surface2 }]}>
              <Ionicons name="time-outline" size={40} color={C.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: C.text }]}>No history yet</Text>
            <Text style={[styles.emptyDesc, { color: C.textSecondary }]}>
              Downloaded tracks will appear here once completed
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  headerTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 8 },
  clearText: { fontSize: 13, fontFamily: "Inter_400Regular" },

  list: { paddingHorizontal: 16, paddingTop: 4 },
  emptyList: { flex: 1 },

  card: { borderRadius: 14, padding: 14, marginBottom: 8 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  art: { width: 50, height: 50, borderRadius: 8 },
  artPlaceholder: { backgroundColor: C.surface3, alignItems: "center", justifyContent: "center" },
  info: { flex: 1 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  artist: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },

  actions: { flexDirection: "row", gap: 6 },
  actionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 10 },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
