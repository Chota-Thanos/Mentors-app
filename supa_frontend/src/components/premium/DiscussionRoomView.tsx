"use client";

import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  UID,
} from "agora-rtc-sdk-ng";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Video,
  VideoOff,
} from "lucide-react";

import { premiumApi } from "@/lib/premiumApi";
import { createClient } from "@/lib/supabase/client";
import type { DiscussionCallContext, DiscussionSpeakerRequest } from "@/types/premium";

type ParticipantTile = {
  key: string;
  uid: UID | null;
  displayName: string;
  isHost: boolean;
  isSelf: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  remoteUser?: IAgoraRTCRemoteUser | null;
};

type AgoraModule = typeof import("agora-rtc-sdk-ng").default;

const describeError = (error: unknown, fallback: string): string => {
  if (typeof error === "object" && error !== null) {
    const record = error as {
      message?: string;
      reason?: string;
      response?: { data?: { detail?: string } };
    };
    if (typeof record.response?.data?.detail === "string" && record.response.data.detail.trim()) {
      return record.response.data.detail;
    }
    if (typeof record.reason === "string" && record.reason.trim()) {
      return record.reason;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }
  return fallback;
};

const initials = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";

const tileKeyFromUid = (uid: UID | null | undefined): string => String(uid ?? "local");

export default function DiscussionRoomView({
  endpoint,
  backHref,
  titleFallback,
}: {
  endpoint: string;
  backHref: string;
  titleFallback: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const autoJoinRequested = searchParams.get("autojoin") === "1";

  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<DiscussionCallContext | null>(null);
  const [inRoom, setInRoom] = useState(false);
  const [audioMuted, setAudioMuted] = useState(true);
  const [videoOn, setVideoOn] = useState(false);
  const [participants, setParticipants] = useState<ParticipantTile[]>([]);
  const [speakerRequests, setSpeakerRequests] = useState<DiscussionSpeakerRequest[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localAudioTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const localVideoTrackRef = useRef<ICameraVideoTrack | null>(null);
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const clientListenersRef = useRef<Array<{ event: string; listener: (...args: unknown[]) => void }>>([]);
  const autoJoinAttemptedRef = useRef<string>("");

  const isAgoraRoom = Boolean(
    context?.call_provider === "zoom_video_sdk" && context.agora_app_id && context.agora_channel,
  );
  const participantRole = context?.participant_role || (context?.sdk_role_type === 1 ? "host" : "listener");
  const isHost = participantRole === "host";
  const hostControlsEnabled = Boolean(context?.host_controls_enabled);
  const canPublish = Boolean(context?.sdk_role_type === 1);

  const clearVideoTiles = useCallback(() => {
    Object.values(tileRefs.current).forEach((node) => {
      if (node) node.innerHTML = "";
    });
  }, []);

  const removeClientListeners = useCallback((client: IAgoraRTCClient | null) => {
    if (!client) return;
    for (const binding of clientListenersRef.current) {
      try {
        client.off(binding.event as never, binding.listener as never);
      } catch {
        // Ignore stale listener cleanup.
      }
    }
    clientListenersRef.current = [];
  }, []);

  const syncParticipants = useCallback((clientOverride?: IAgoraRTCClient | null) => {
    const activeClient = clientOverride || clientRef.current;
    const localUid = context?.agora_uid ?? null;
    const localName = String(context?.sdk_user_name || (isHost ? "Host" : "Participant")).trim() || "Participant";
    const remoteBaseName = isHost ? "Learner" : "Host";

    const nextParticipants: ParticipantTile[] = [];
    if (
      canPublish &&
      localUid !== null &&
      (inRoom || Boolean(localAudioTrackRef.current) || Boolean(localVideoTrackRef.current))
    ) {
      nextParticipants.push({
        key: tileKeyFromUid(localUid),
        uid: localUid,
        displayName: localName,
        isHost,
        isSelf: true,
        hasVideo: Boolean(localVideoTrackRef.current && videoOn),
        hasAudio: Boolean(localAudioTrackRef.current && !audioMuted),
      });
    }

    (activeClient?.remoteUsers || []).forEach((user, index) => {
      nextParticipants.push({
        key: tileKeyFromUid(user.uid),
        uid: user.uid,
        displayName: `${remoteBaseName}${index > 0 ? ` ${index + 1}` : ""}`,
        isHost: !isHost,
        isSelf: false,
        hasVideo: Boolean(user.hasVideo && user.videoTrack),
        hasAudio: Boolean(user.hasAudio && user.audioTrack),
        remoteUser: user,
      });
    });

    setParticipants(nextParticipants);
  }, [audioMuted, canPublish, context?.agora_uid, context?.sdk_user_name, inRoom, isHost, videoOn]);

  const cleanupRoom = useCallback(async () => {
    removeClientListeners(clientRef.current);
    clearVideoTiles();

    try {
      if (localVideoTrackRef.current) {
        localVideoTrackRef.current.stop();
        localVideoTrackRef.current.close();
      }
    } catch {
      // Ignore cleanup errors.
    }
    try {
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current.close();
      }
    } catch {
      // Ignore cleanup errors.
    }

    localVideoTrackRef.current = null;
    localAudioTrackRef.current = null;

    if (clientRef.current) {
      try {
        await clientRef.current.unpublish();
      } catch {
        // Ignore unpublish failures while tearing down.
      }
      try {
        await clientRef.current.leave();
      } catch {
        // Ignore leave failures while tearing down.
      }
    }

    clientRef.current = null;
    setParticipants([]);
    setVideoOn(false);
    setAudioMuted(true);
    setInRoom(false);
  }, [clearVideoTiles, removeClientListeners]);

  const loadContext = useCallback(async (isRefresh = false): Promise<boolean> => {
    if (!isRefresh) setLoading(true);
    try {
      const response = await premiumApi.post<DiscussionCallContext>(endpoint, {});
      setContext(response.data);
      return true;
    } catch (error: unknown) {
      toast.error("Failed to open discussion room", {
        description: describeError(error, "The discussion room could not be loaded."),
      });
      return false;
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, [endpoint]);

  const loadSpeakerRequests = useCallback(
    async (
      scopeType?: "series" | "test",
      scopeId?: number,
      discussionKey?: "final_discussion" | "test_discussion",
    ) => {
      if (!scopeType || !scopeId || !discussionKey) {
        setSpeakerRequests([]);
        return;
      }
      try {
        const response = await premiumApi.get<DiscussionSpeakerRequest[]>("/discussion/speaker-requests", {
          params: {
            scope_type: scopeType,
            scope_id: scopeId,
            discussion_key: discussionKey,
          },
        });
        setSpeakerRequests(Array.isArray(response.data) ? response.data : []);
      } catch (error: unknown) {
        toast.error("Could not load speaker requests", {
          description: describeError(error, "The speaker request queue could not be loaded."),
        });
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      await cleanupRoom();
      if (cancelled) return;
      await loadContext(false);
    };
    void init();
    return () => {
      cancelled = true;
      void cleanupRoom();
    };
  }, [cleanupRoom, loadContext]);

  useEffect(() => {
    if (!context?.scope_type || !context?.scope_id || !context?.discussion_key) return;
    void loadSpeakerRequests(context.scope_type, context.scope_id, context.discussion_key);
  }, [context?.discussion_key, context?.scope_id, context?.scope_type, loadSpeakerRequests]);

  useEffect(() => {
    if (!context?.discussion_channel) return;
    const channel = supabase
      .channel(`discussion-speaker-${context.discussion_channel}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "discussion_speaker_requests",
          filter: `discussion_channel=eq.${context.discussion_channel}`,
        },
        () => {
          void loadSpeakerRequests(context.scope_type, context.scope_id, context.discussion_key);
          void loadContext(true);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    context?.discussion_channel,
    context?.discussion_key,
    context?.scope_id,
    context?.scope_type,
    loadContext,
    loadSpeakerRequests,
    supabase,
  ]);

  useEffect(() => {
    if (!inRoom || !localVideoTrackRef.current || context?.agora_uid === undefined || context?.agora_uid === null) return;
    const node = tileRefs.current[tileKeyFromUid(context.agora_uid)];
    if (!node) return;
    node.innerHTML = "";
    localVideoTrackRef.current.play(node);
  }, [context?.agora_uid, inRoom, participants]);

  useEffect(() => {
    participants.forEach((participant) => {
      if (participant.isSelf) return;
      const node = tileRefs.current[participant.key];
      if (participant.hasVideo && participant.remoteUser?.videoTrack && node) {
        node.innerHTML = "";
        participant.remoteUser.videoTrack.play(node);
      } else if (node) {
        node.innerHTML = "";
      }
      if (participant.hasAudio && participant.remoteUser?.audioTrack) {
        participant.remoteUser.audioTrack.play();
      }
    });
  }, [participants]);

  const registerClientListeners = useCallback((client: IAgoraRTCClient) => {
    const sync = () => syncParticipants(client);
    const onUserPublished = async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      await client.subscribe(user, mediaType);
      if (mediaType === "audio" && user.audioTrack) {
        user.audioTrack.play();
      }
      sync();
    };
    const onUserUnpublished = (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      if (mediaType === "audio" && user.audioTrack) {
        user.audioTrack.stop();
      }
      const node = tileRefs.current[tileKeyFromUid(user.uid)];
      if (node) node.innerHTML = "";
      sync();
    };
    const onUserJoined = () => sync();
    const onUserLeft = (user: IAgoraRTCRemoteUser) => {
      if (user.audioTrack) user.audioTrack.stop();
      const node = tileRefs.current[tileKeyFromUid(user.uid)];
      if (node) node.innerHTML = "";
      sync();
    };

    const bindings = [
      { event: "user-published", listener: onUserPublished as (...args: unknown[]) => void },
      { event: "user-unpublished", listener: onUserUnpublished as (...args: unknown[]) => void },
      { event: "user-joined", listener: onUserJoined as (...args: unknown[]) => void },
      { event: "user-left", listener: onUserLeft as (...args: unknown[]) => void },
    ];
    bindings.forEach((binding) => client.on(binding.event as never, binding.listener as never));
    clientListenersRef.current = bindings;
  }, [syncParticipants]);

  const publishLocalTracks = useCallback(async (agoraRtc: AgoraModule, client: IAgoraRTCClient) => {
    if (localAudioTrackRef.current || localVideoTrackRef.current) return;
    const audioTrack = await agoraRtc.createMicrophoneAudioTrack();
    const videoTrack = await agoraRtc.createCameraVideoTrack();
    localAudioTrackRef.current = audioTrack;
    localVideoTrackRef.current = videoTrack;
    await client.publish([audioTrack, videoTrack]);
    setAudioMuted(false);
    setVideoOn(true);
    syncParticipants(client);
  }, [syncParticipants]);

  const unpublishLocalTracks = useCallback(async (clientOverride?: IAgoraRTCClient | null) => {
    const activeClient = clientOverride || clientRef.current;
    const tracks = [localAudioTrackRef.current, localVideoTrackRef.current].filter(Boolean) as Array<IMicrophoneAudioTrack | ICameraVideoTrack>;
    if (activeClient && tracks.length) {
      try {
        await activeClient.unpublish(tracks);
      } catch {
        // Ignore unpublish errors during role changes.
      }
    }
    try {
      localVideoTrackRef.current?.stop();
      localVideoTrackRef.current?.close();
    } catch {
      // noop
    }
    try {
      localAudioTrackRef.current?.stop();
      localAudioTrackRef.current?.close();
    } catch {
      // noop
    }
    localVideoTrackRef.current = null;
    localAudioTrackRef.current = null;
    setAudioMuted(true);
    setVideoOn(false);
    syncParticipants(activeClient);
  }, [syncParticipants]);

  useEffect(() => {
    if (!inRoom || !clientRef.current || !context) return;
    let cancelled = false;

    const applyRoleChange = async () => {
      const client = clientRef.current;
      if (!client) return;
      const shouldPublish = context.sdk_role_type === 1;
      await client.setClientRole(shouldPublish ? "host" : "audience");
      if (shouldPublish) {
        const agoraRtc = (await import("agora-rtc-sdk-ng")).default as AgoraModule;
        if (!cancelled) {
          await publishLocalTracks(agoraRtc, client);
        }
      } else if (!cancelled) {
        await unpublishLocalTracks(client);
      }
      if (!cancelled) {
        syncParticipants(client);
      }
    };

    void applyRoleChange();
    return () => {
      cancelled = true;
    };
  }, [context, inRoom, publishLocalTracks, syncParticipants, unpublishLocalTracks]);

  const joinRoom = useCallback(async () => {
    if (!context?.agora_app_id || !context.agora_channel) {
      toast.error("Room unavailable", {
        description: context?.provider_error || "This discussion does not have a valid Agora room yet.",
      });
      return;
    }

    setActionBusy("join");
    try {
      await cleanupRoom();
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default as AgoraModule;
      const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
      registerClientListeners(client);
      clientRef.current = client;
      await client.setClientRole(canPublish ? "host" : "audience");
      await client.join(
        context.agora_app_id,
        context.agora_channel,
        context.agora_token || null,
        context.agora_uid ?? null,
      );

      if (canPublish) {
        await publishLocalTracks(AgoraRTC, client);
      }

      setInRoom(true);
      syncParticipants(client);
      toast.success("Joined discussion room");
    } catch (error: unknown) {
      await cleanupRoom();
      toast.error("Could not join the room", {
        description: describeError(error, "Agora could not start the discussion room."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [canPublish, cleanupRoom, context, publishLocalTracks, registerClientListeners, syncParticipants]);

  const leaveRoom = useCallback(async () => {
    setActionBusy("leave");
    try {
      await cleanupRoom();
      toast.success("You left the discussion room");
    } catch (error: unknown) {
      toast.error("Could not leave the room", {
        description: describeError(error, "The room could not be closed cleanly."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [cleanupRoom]);

  const toggleAudio = useCallback(async () => {
    const track = localAudioTrackRef.current;
    if (!track) return;
    try {
      const nextMuted = !audioMuted;
      await track.setMuted(nextMuted);
      setAudioMuted(nextMuted);
      syncParticipants();
    } catch (error: unknown) {
      toast.error("Audio control failed", {
        description: describeError(error, "Microphone state could not be changed."),
      });
    }
  }, [audioMuted, syncParticipants]);

  const toggleVideo = useCallback(async () => {
    const track = localVideoTrackRef.current;
    if (!track) return;
    try {
      const nextVideoOn = !videoOn;
      await track.setEnabled(nextVideoOn);
      if (!nextVideoOn) {
        track.stop();
        const node = context?.agora_uid !== undefined && context?.agora_uid !== null
          ? tileRefs.current[tileKeyFromUid(context.agora_uid)]
          : null;
        if (node) node.innerHTML = "";
      }
      setVideoOn(nextVideoOn);
      syncParticipants();
    } catch (error: unknown) {
      toast.error("Video control failed", {
        description: describeError(error, "Camera state could not be changed."),
      });
    }
  }, [context?.agora_uid, syncParticipants, videoOn]);

  const refreshRoomContext = useCallback(async () => {
    setActionBusy("refresh");
    try {
      const refreshed = await loadContext(true);
      if (refreshed && context) {
        await loadSpeakerRequests(context.scope_type, context.scope_id, context.discussion_key);
      }
      if (refreshed) toast.success("Room access refreshed");
    } finally {
      setActionBusy(null);
    }
  }, [context, loadContext, loadSpeakerRequests]);

  const requestToSpeak = useCallback(async () => {
    if (!context) return;
    setActionBusy("request-speaker");
    try {
      const endpointPath =
        context.scope_type === "series"
          ? `/test-series/${context.scope_id}/discussion-request-to-speak`
          : `/tests/${context.scope_id}/discussion-request-to-speak`;
      await premiumApi.post(endpointPath, {});
      await loadSpeakerRequests(context.scope_type, context.scope_id, context.discussion_key);
      toast.success("Speaker request sent");
    } catch (error: unknown) {
      toast.error("Could not request speaker access", {
        description: describeError(error, "The host could not be notified."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [context, loadSpeakerRequests]);

  const updateSpeakerRequest = useCallback(async (requestId: number, action: "approve" | "reject" | "remove" | "withdraw") => {
    if (!context) return;
    setActionBusy(`${action}-${requestId}`);
    try {
      await premiumApi.post(`/discussion/speaker-requests/${requestId}/${action}`);
      await Promise.all([
        loadSpeakerRequests(context.scope_type, context.scope_id, context.discussion_key),
        loadContext(true),
      ]);
      toast.success(
        action === "approve"
          ? "Speaker access granted"
          : action === "withdraw"
            ? "Speaker request withdrawn"
            : action === "remove"
              ? "Speaker removed"
              : "Speaker request declined",
      );
    } catch (error: unknown) {
      toast.error("Could not update speaker access", {
        description: describeError(error, "The speaker request could not be updated."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [context, loadContext, loadSpeakerRequests]);

  const joinUrl = context?.join_url || context?.room_url || null;
  const latestOwnSpeakerRequest = !hostControlsEnabled ? speakerRequests[0] || null : null;

  useEffect(() => {
    if (!context || inRoom || actionBusy !== null || !autoJoinRequested) return;
    const autoJoinKey = `${context.scope_type}:${context.scope_id}:${context.discussion_key}:${context.call_provider}:${context.agora_channel || joinUrl || ""}`;
    if (autoJoinAttemptedRef.current === autoJoinKey) return;
    autoJoinAttemptedRef.current = autoJoinKey;

    if (isAgoraRoom) {
      void joinRoom();
      return;
    }
    if (joinUrl && typeof window !== "undefined") {
      window.location.assign(joinUrl);
    }
  }, [actionBusy, autoJoinRequested, context, inRoom, isAgoraRoom, joinRoom, joinUrl]);

  const title = context?.title || titleFallback;

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.5),_rgba(248,250,252,1)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-center rounded-[30px] border border-slate-200 bg-white px-6 py-16 shadow-sm">
          <div className="flex items-center gap-3 text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading discussion room...
          </div>
        </div>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.5),_rgba(248,250,252,1)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-center rounded-[30px] border border-slate-200 bg-white px-6 py-16 shadow-sm">
          <p className="text-slate-600">The discussion room could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.5),_rgba(248,250,252,1)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-slate-950 text-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Agora discussion room</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-slate-400">
                {participantRole === "host" ? "Host controls enabled" : participantRole === "speaker" ? "Speaker access enabled" : "Listener join view"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isAgoraRoom && !inRoom ? (
                <button
                  type="button"
                  onClick={() => void joinRoom()}
                  disabled={actionBusy !== null}
                  className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
                >
                  {actionBusy === "join" ? "Joining..." : "Join Agora room"}
                </button>
              ) : null}
              {!isAgoraRoom && joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Open join link
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              ) : null}
            </div>
          </div>

          <div className="grid min-h-[520px] gap-4 p-4 md:grid-cols-2">
            {participants.length > 0 ? (
              participants.map((participant) => (
                <article key={participant.key} className="relative overflow-hidden rounded-[26px] border border-white/10 bg-black/60">
                  <div ref={(node) => { tileRefs.current[participant.key] = node; }} className="absolute inset-0" />
                  {!participant.hasVideo ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.32),_rgba(15,23,42,0.96)_70%)]">
                      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/10 text-2xl font-black">
                        {initials(participant.displayName)}
                      </div>
                      <div className="text-center">
                        <p className="text-base font-semibold">{participant.displayName}</p>
                        <p className="text-xs text-slate-300">{participant.isSelf ? "Camera off" : "Waiting for video"}</p>
                      </div>
                    </div>
                  ) : null}
                  <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-full bg-slate-950/70 px-4 py-2 backdrop-blur">
                    <div>
                      <p className="text-sm font-semibold">{participant.displayName}</p>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                        {participant.isHost ? "Host" : "Participant"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {participant.hasAudio ? (
                        <Mic className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <MicOff className="h-4 w-4 text-rose-300" />
                      )}
                      {participant.hasVideo ? (
                        <Video className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <VideoOff className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="col-span-full flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-[26px] border border-dashed border-white/10 bg-white/[0.03] text-center">
                <div className="space-y-2">
                  <p className="text-lg font-semibold">{inRoom ? "Waiting for the host to broadcast." : "Room not joined yet."}</p>
                  <p className="max-w-md text-sm text-slate-300">
                    {isHost
                      ? "Start the room and your camera/audio will go live for learners inside the series."
                      : participantRole === "speaker"
                        ? "Your speaker access is active. Join the room and use your mic or camera when the host invites you into the discussion."
                        : "Join the room to wait for the host. When the creator starts broadcasting, the class video appears here."}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-6 py-4">
            {inRoom ? (
              <button
                type="button"
                onClick={() => void leaveRoom()}
                disabled={actionBusy !== null}
                className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-60"
              >
                <PhoneOff className="h-4 w-4" />
                Leave room
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void refreshRoomContext()}
                disabled={actionBusy !== null}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${actionBusy === "refresh" ? "animate-spin" : ""}`} />
                Refresh access
              </button>
            )}
            {canPublish && inRoom ? (
              <>
                <button
                  type="button"
                  onClick={() => void toggleAudio()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {audioMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {audioMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleVideo()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {videoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  {videoOn ? "Camera off" : "Camera on"}
                </button>
              </>
            ) : null}
          </div>
        </section>

        <aside className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Session guide</p>
          <h2 className="mt-4 text-[2rem] font-black leading-tight text-slate-900">Run the class from one room.</h2>
          <p className="mt-4 text-base leading-8 text-slate-600">
            Agora now powers live discussion classes inside the series. The host starts the class and learners join the same room directly from the series page.
          </p>

          <div className="mt-6 space-y-4">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Scheduled for</p>
              <p className="mt-3 text-2xl font-semibold text-slate-900">
                {context.scheduled_for ? new Date(context.scheduled_for).toLocaleString() : "Not scheduled"}
              </p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Duration</p>
              <p className="mt-3 text-2xl font-semibold text-slate-900">
                {context.duration_minutes ? `${context.duration_minutes} min` : "Flexible"}
              </p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Role</p>
              <p className="mt-3 text-2xl font-semibold text-slate-900">
                {participantRole === "host" ? "Host" : participantRole === "speaker" ? "Speaker" : "Listener"}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              {hostControlsEnabled ? "Speaker queue" : "Speaker access"}
            </p>
            {hostControlsEnabled ? (
              speakerRequests.length > 0 ? (
                speakerRequests.map((request) => (
                  <div key={request.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{request.display_name}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{request.status}</p>
                        <p className="mt-2 text-xs text-slate-500">{new Date(request.requested_at).toLocaleString()}</p>
                        {request.note ? <p className="mt-2 text-sm text-slate-600">{request.note}</p> : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {request.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void updateSpeakerRequest(request.id, "approve")}
                            disabled={actionBusy !== null}
                            className="rounded-full bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-60"
                          >
                            {actionBusy === `approve-${request.id}` ? "Approving..." : "Approve speaker"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateSpeakerRequest(request.id, "reject")}
                            disabled={actionBusy !== null}
                            className="rounded-full border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-60"
                          >
                            {actionBusy === `reject-${request.id}` ? "Declining..." : "Decline"}
                          </button>
                        </>
                      ) : request.status === "approved" ? (
                        <button
                          type="button"
                          onClick={() => void updateSpeakerRequest(request.id, "remove")}
                          disabled={actionBusy !== null}
                          className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                        >
                          {actionBusy === `remove-${request.id}` ? "Removing..." : "Return to listener"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No active speaker requests yet.
                </div>
              )
            ) : latestOwnSpeakerRequest ? (
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {latestOwnSpeakerRequest.status === "approved"
                    ? "You can speak now."
                    : latestOwnSpeakerRequest.status === "pending"
                      ? "Speaker request pending."
                      : latestOwnSpeakerRequest.status === "rejected"
                        ? "Speaker request declined."
                        : latestOwnSpeakerRequest.status === "removed"
                          ? "Speaker access was ended."
                          : "Speaker request withdrawn."}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {latestOwnSpeakerRequest.status === "approved"
                    ? "Refresh access if your controls do not appear immediately."
                    : latestOwnSpeakerRequest.status === "pending"
                      ? "The host will approve or decline your request."
                      : "You can request speaking access again whenever needed."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {latestOwnSpeakerRequest.status === "pending" || latestOwnSpeakerRequest.status === "approved" ? (
                    <button
                      type="button"
                      onClick={() => void updateSpeakerRequest(latestOwnSpeakerRequest.id, "withdraw")}
                      disabled={actionBusy !== null}
                      className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      {actionBusy === `withdraw-${latestOwnSpeakerRequest.id}`
                        ? latestOwnSpeakerRequest.status === "approved" ? "Leaving speaker mode..." : "Withdrawing..."
                        : latestOwnSpeakerRequest.status === "approved" ? "Return to listener" : "Withdraw request"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void requestToSpeak()}
                      disabled={actionBusy !== null}
                      className="rounded-full bg-indigo-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {actionBusy === "request-speaker" ? "Sending..." : "Request to speak"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Need to ask a question live?</p>
                <p className="mt-2 text-sm text-slate-600">
                  Request speaker access and the host can promote you from listener to speaker without reopening the room.
                </p>
                <button
                  type="button"
                  onClick={() => void requestToSpeak()}
                  disabled={actionBusy !== null}
                  className="mt-3 rounded-full bg-indigo-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {actionBusy === "request-speaker" ? "Sending..." : "Request to speak"}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            Back to series
          </button>
        </aside>
      </div>
    </div>
  );
}
