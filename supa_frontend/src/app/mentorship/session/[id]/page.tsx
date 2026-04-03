"use client";

import type {
  IAgoraRTCClient,
  ILocalVideoTrack,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  UID,
} from "agora-rtc-sdk-ng";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  RefreshCw,
  Video,
  VideoOff,
} from "lucide-react";

import { premiumApi } from "@/lib/premiumApi";

type MentorshipCallProvider = "custom" | "zoom" | "zoom_video_sdk";
type MentorshipMode = "video" | "audio";

type MentorshipCallContext = {
  session_id: number;
  request_id: number;
  call_provider: MentorshipCallProvider;
  mode: MentorshipMode;
  join_url?: string | null;
  host_url?: string | null;
  room_url?: string | null;
  sdk_user_name?: string | null;
  sdk_user_identity?: string | null;
  sdk_role_type?: number | null;
  agora_app_id?: string | null;
  agora_channel?: string | null;
  agora_token?: string | null;
  agora_uid?: number | null;
  provider_payload?: Record<string, unknown>;
  provider_error?: string | null;
  available_from?: string | null;
  available_until?: string | null;
};

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

const providerLabel = (provider: MentorshipCallProvider): string => {
  if (provider === "zoom_video_sdk") return "Agora room";
  if (provider === "zoom") return "Zoom meeting";
  return "External call link";
};

const initials = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";

const tileKeyFromUid = (uid: UID | null | undefined): string => String(uid ?? "local");

export default function MentorshipSessionRoom() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = typeof params.id === "string" ? Number.parseInt(params.id, 10) : 0;

  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<MentorshipCallContext | null>(null);
  const [inSession, setInSession] = useState(false);
  const [audioMuted, setAudioMuted] = useState(true);
  const [videoOn, setVideoOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<ParticipantTile[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState("");

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localAudioTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const localCameraTrackRef = useRef<ICameraVideoTrack | null>(null);
  const localVideoTrackRef = useRef<ILocalVideoTrack | null>(null);
  const localScreenTrackRef = useRef<ILocalVideoTrack | null>(null);
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const clientListenersRef = useRef<Array<{ event: string; listener: (...args: unknown[]) => void }>>([]);
  const autoJoinAttemptedRef = useRef<string>("");

  const isAgoraRoom = Boolean(
    context?.call_provider === "zoom_video_sdk" && context.agora_app_id && context.agora_channel,
  );
  const autoJoinRequested = searchParams.get("autojoin") === "1";
  const isHost = Boolean(context && (context.sdk_role_type === 1 || context.host_url));
  const exitHref = useMemo(() => {
    if (isHost) return "/mentorship/manage";
    if (context?.request_id) return `/my-purchases/mentorship/${context.request_id}`;
    return "/dashboard";
  }, [context?.request_id, isHost]);

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
    const baseLocalName = String(context?.sdk_user_name || (isHost ? "Mentor" : "Learner")).trim() || "Participant";
    const localName = screenSharing ? `${baseLocalName} · Sharing screen` : baseLocalName;
    const remoteBaseName = isHost ? "Learner" : "Mentor";

    const nextParticipants: ParticipantTile[] = [];
    if (localUid !== null && (inSession || Boolean(localAudioTrackRef.current) || Boolean(localVideoTrackRef.current))) {
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
  }, [audioMuted, context?.agora_uid, context?.sdk_user_name, inSession, isHost, screenSharing, videoOn]);

  const cleanupSession = useCallback(async () => {
    removeClientListeners(clientRef.current);
    clearVideoTiles();

    try {
      if (localVideoTrackRef.current) {
        localVideoTrackRef.current.stop();
      }
    } catch {
      // Ignore cleanup errors for closed tracks.
    }
    try {
      if (localScreenTrackRef.current) {
        localScreenTrackRef.current.close();
      }
    } catch {
      // Ignore cleanup errors for closed tracks.
    }
    try {
      if (localCameraTrackRef.current && localCameraTrackRef.current !== localScreenTrackRef.current) {
        localCameraTrackRef.current.close();
      }
    } catch {
      // Ignore cleanup errors for closed tracks.
    }
    try {
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current.close();
      }
    } catch {
      // Ignore cleanup errors for closed tracks.
    }

    localVideoTrackRef.current = null;
    localCameraTrackRef.current = null;
    localScreenTrackRef.current = null;
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
    setScreenSharing(false);
    setInSession(false);
  }, [clearVideoTiles, removeClientListeners]);

  const loadContext = useCallback(async (isRefresh = false): Promise<boolean> => {
    if (!sessionId) return false;
    if (!isRefresh) setLoading(true);
    try {
      const response = await premiumApi.post<MentorshipCallContext>(`/mentorship/sessions/${sessionId}/call-context`, {});
      setContext(response.data);
      return true;
    } catch (error: unknown) {
      toast.error("Failed to open session", {
        description: describeError(error, "The session room could not be loaded."),
      });
      return false;
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!sessionId) return;
      await cleanupSession();
      if (cancelled) return;
      await loadContext(false);
    };
    void init();
    return () => {
      cancelled = true;
      void cleanupSession();
    };
  }, [cleanupSession, loadContext, sessionId]);

  useEffect(() => {
    if (!inSession || !localVideoTrackRef.current || context?.agora_uid === undefined || context?.agora_uid === null) return;
    const node = tileRefs.current[tileKeyFromUid(context.agora_uid)];
    if (!node) return;
    node.innerHTML = "";
    localVideoTrackRef.current.play(node);
  }, [context?.agora_uid, inSession, participants, videoOn]);

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
      if (user.audioTrack) {
        user.audioTrack.stop();
      }
      const node = tileRefs.current[tileKeyFromUid(user.uid)];
      if (node) node.innerHTML = "";
      sync();
    };
    const onConnectionStateChange = (currentState: string) => {
      if (currentState === "DISCONNECTED") {
        setInSession(false);
      }
      sync();
    };

    const bindings = [
      { event: "user-published", listener: onUserPublished as (...args: unknown[]) => void },
      { event: "user-unpublished", listener: onUserUnpublished as (...args: unknown[]) => void },
      { event: "user-joined", listener: onUserJoined as (...args: unknown[]) => void },
      { event: "user-left", listener: onUserLeft as (...args: unknown[]) => void },
      { event: "connection-state-change", listener: onConnectionStateChange as (...args: unknown[]) => void },
    ];

    bindings.forEach((binding) => client.on(binding.event as never, binding.listener as never));
    clientListenersRef.current = bindings;
  }, [syncParticipants]);

  const joinSession = useCallback(async () => {
    if (!context?.agora_app_id || !context.agora_channel) {
      toast.error("Room unavailable", {
        description: context?.provider_error || "This session does not have a valid Agora room yet.",
      });
      return;
    }

    setActionBusy("join");
    try {
      await cleanupSession();
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default as AgoraModule;
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      registerClientListeners(client);
      clientRef.current = client;

      await client.join(
        context.agora_app_id,
        context.agora_channel,
        context.agora_token || null,
        context.agora_uid ?? null,
      );

      const tracksToPublish: Array<IMicrophoneAudioTrack | ICameraVideoTrack> = [];
      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      localAudioTrackRef.current = audioTrack;
      tracksToPublish.push(audioTrack);

      let nextVideoOn = false;
      if (context.mode === "video") {
        const videoTrack = await AgoraRTC.createCameraVideoTrack();
        localCameraTrackRef.current = videoTrack;
        localVideoTrackRef.current = videoTrack;
        tracksToPublish.push(videoTrack);
        nextVideoOn = true;
      }

      await client.publish(tracksToPublish);
      setAudioMuted(false);
      setVideoOn(nextVideoOn);
      setScreenSharing(false);
      setInSession(true);
      syncParticipants(client);
      toast.success("Joined mentorship room");
    } catch (error: unknown) {
      await cleanupSession();
      toast.error("Could not join the room", {
        description: describeError(error, "Agora could not start the mentorship room."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [cleanupSession, context, registerClientListeners, syncParticipants]);

  const leaveSession = useCallback(async () => {
    setActionBusy("leave");
    try {
      await cleanupSession();
      toast.success("You left the mentorship room");
    } catch (error: unknown) {
      toast.error("Could not leave the room", {
        description: describeError(error, "The session could not be closed cleanly."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [cleanupSession]);

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
    if (screenSharing) return;
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
  }, [context?.agora_uid, screenSharing, syncParticipants, videoOn]);

  const restoreCameraTrack = useCallback(async () => {
    const client = clientRef.current;
    const cameraTrack = localCameraTrackRef.current;
    if (!client || !cameraTrack) {
      localVideoTrackRef.current = null;
      setScreenSharing(false);
      setVideoOn(false);
      syncParticipants();
      return;
    }
    try {
      await cameraTrack.setEnabled(true);
    } catch {
      // Ignore re-enable failures on restore.
    }
    await client.publish(cameraTrack);
    localVideoTrackRef.current = cameraTrack;
    setScreenSharing(false);
    setVideoOn(true);
    syncParticipants(client);
  }, [syncParticipants]);

  const stopScreenShare = useCallback(async (restoreCamera = true) => {
    const client = clientRef.current;
    const screenTrack = localScreenTrackRef.current;
    if (!screenTrack) return;
    try {
      if (client) {
        await client.unpublish(screenTrack);
      }
    } catch {
      // Ignore unpublish errors while stopping share.
    }
    screenTrack.stop();
    screenTrack.close();
    localScreenTrackRef.current = null;
    if (restoreCamera) {
      await restoreCameraTrack();
      return;
    }
    localVideoTrackRef.current = null;
    setScreenSharing(false);
    setVideoOn(false);
    syncParticipants(client);
  }, [restoreCameraTrack, syncParticipants]);

  const toggleScreenShare = useCallback(async () => {
    if (!inSession || context?.mode !== "video" || !clientRef.current) return;
    setActionBusy("screen");
    try {
      if (screenSharing) {
        await stopScreenShare(true);
        toast.success("Screen sharing stopped");
        return;
      }
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default as AgoraModule;
      const screenTrackOrPair = await AgoraRTC.createScreenVideoTrack(
        { encoderConfig: "1080p_2" },
        "disable",
      );
      const screenTrack = Array.isArray(screenTrackOrPair) ? screenTrackOrPair[0] : screenTrackOrPair;
      screenTrack.on("track-ended", () => {
        void stopScreenShare(true);
      });

      const activeVideoTrack = localVideoTrackRef.current;
      if (activeVideoTrack) {
        try {
          await clientRef.current.unpublish(activeVideoTrack);
        } catch {
          // Ignore stale publish state.
        }
        activeVideoTrack.stop();
      }

      await clientRef.current.publish(screenTrack);
      localScreenTrackRef.current = screenTrack;
      localVideoTrackRef.current = screenTrack;
      setScreenSharing(true);
      setVideoOn(true);
      syncParticipants(clientRef.current);
      toast.success("Screen sharing started");
    } catch (error: unknown) {
      toast.error("Screen sharing failed", {
        description: describeError(error, "The browser could not start screen sharing."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [context?.mode, inSession, screenSharing, stopScreenShare, syncParticipants]);

  const refreshSessionContext = useCallback(async () => {
    setActionBusy("refresh");
    try {
      const refreshed = await loadContext(true);
      if (refreshed) {
        toast.success("Session access refreshed");
      }
    } catch {
      // Error toast comes from loadContext.
    } finally {
      setActionBusy(null);
    }
  }, [loadContext]);

  const recreateProviderSession = useCallback(async () => {
    setActionBusy("recreate");
    try {
      await premiumApi.post(`/mentorship/sessions/${sessionId}/recreate-provider-session`, {});
      await loadContext(true);
      toast.success("Provider meeting refreshed");
    } catch (error: unknown) {
      toast.error("Could not recreate the meeting", {
        description: describeError(error, "The provider meeting could not be refreshed."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [loadContext, sessionId]);

  const completeSession = useCallback(async () => {
    setActionBusy("complete");
    try {
      await premiumApi.post(`/mentorship/sessions/${sessionId}/complete`, {
        summary: sessionSummary.trim() || null,
      });
      await cleanupSession();
      toast.success("Session completed");
      router.push(exitHref);
    } catch (error: unknown) {
      toast.error("Could not complete the session", {
        description: describeError(error, "The session could not be marked complete."),
      });
    } finally {
      setActionBusy(null);
    }
  }, [cleanupSession, exitHref, router, sessionId, sessionSummary]);

  const joinUrl = context?.join_url || context?.room_url || null;

  useEffect(() => {
    if (!context || inSession || actionBusy !== null || !autoJoinRequested) return;
    const autoJoinKey = `${context.session_id}:${context.call_provider}:${context.agora_channel || joinUrl || ""}`;
    if (autoJoinAttemptedRef.current === autoJoinKey) return;
    autoJoinAttemptedRef.current = autoJoinKey;

    if (isAgoraRoom) {
      void joinSession();
      return;
    }
    if (joinUrl && typeof window !== "undefined") {
      window.location.assign(joinUrl);
    }
  }, [actionBusy, autoJoinRequested, context, inSession, isAgoraRoom, joinSession, joinUrl]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.5),_rgba(248,250,252,1)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-center rounded-[30px] border border-slate-200 bg-white px-6 py-16 shadow-sm">
          <div className="flex items-center gap-3 text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading mentorship room...
          </div>
        </div>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.5),_rgba(248,250,252,1)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-center rounded-[30px] border border-slate-200 bg-white px-6 py-16 shadow-sm">
          <p className="text-slate-600">The mentorship room could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.5),_rgba(248,250,252,1)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-slate-950 text-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{providerLabel(context.call_provider)}</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">
                {isAgoraRoom ? (context.sdk_user_name ? `${context.sdk_user_name}'s Agora room` : `Mentorship Session #${sessionId}`) : `Mentorship Session #${sessionId}`}
              </h1>
              <p className="mt-1 text-sm text-slate-400">{isHost ? "Mentor controls enabled" : "Learner join view"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isAgoraRoom && !inSession ? (
                <button
                  type="button"
                  onClick={() => void joinSession()}
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
              {isHost && context.host_url ? (
                <a
                  href={context.host_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Host controls
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              ) : null}
            </div>
          </div>

          {isAgoraRoom ? (
            <>
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
                            <p className="text-xs text-slate-300">{participant.isSelf ? "Camera off" : "Waiting for camera"}</p>
                          </div>
                        </div>
                      ) : null}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold">{participant.displayName}</p>
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                            {participant.isHost ? "Host" : participant.isSelf ? "You" : "Participant"}
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${participant.hasVideo ? "bg-emerald-400/15 text-emerald-200" : "bg-white/10 text-slate-300"}`}>
                          {participant.hasVideo ? "Video on" : "Video off"}
                        </span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="col-span-full flex items-center justify-center rounded-[26px] border border-dashed border-white/15 bg-white/5 p-10 text-center">
                    <div>
                      <p className="text-lg font-semibold text-white">{inSession ? "Waiting for the other participant" : "Join the room to begin"}</p>
                      <p className="mt-2 text-sm text-slate-400">
                        {inSession
                          ? "The room is active. Participant tiles will appear as soon as the other side joins."
                          : "This session runs on Agora with live audio and video controls directly in the browser."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {inSession ? (
                <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 px-6 py-5">
                  <button
                    type="button"
                    onClick={() => void toggleAudio()}
                    className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${audioMuted ? "bg-rose-500 hover:bg-rose-400" : "bg-white/10 hover:bg-white/20"}`}
                  >
                    {audioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>
                  {context.mode === "video" ? (
                    <button
                      type="button"
                      onClick={() => void toggleVideo()}
                      disabled={screenSharing}
                      className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${!videoOn ? "bg-rose-500 hover:bg-rose-400" : "bg-white/10 hover:bg-white/20"}`}
                    >
                      {!videoOn ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                    </button>
                  ) : null}
                  {context.mode === "video" ? (
                    <button
                      type="button"
                      onClick={() => void toggleScreenShare()}
                      disabled={actionBusy !== null}
                      className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${screenSharing ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950" : "bg-white/10 hover:bg-white/20"}`}
                    >
                      <MonitorUp className="h-5 w-5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void leaveSession()}
                    disabled={actionBusy !== null}
                    className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
                  >
                    <PhoneOff className="h-4 w-4" />
                    Leave room
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-[520px] flex-col justify-between p-6">
              <div className="max-w-2xl">
                <p className="text-sm text-slate-300">
                  This session uses an external call provider. Open the live join link below or recreate a fresh provider meeting if the current access is missing.
                </p>
                {context.provider_error ? (
                  <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                    {context.provider_error}
                  </div>
                ) : null}
                {!joinUrl ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-4 text-sm text-slate-300">
                    No active join link is attached to this session yet. Refresh access or recreate the provider meeting before starting.
                  </div>
                ) : null}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                {joinUrl ? (
                  <a
                    href={joinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Open call link
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                ) : null}
                {isHost && context.call_provider === "zoom" ? (
                  <button
                    type="button"
                    onClick={() => void recreateProviderSession()}
                    disabled={actionBusy !== null}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
                  >
                    {actionBusy === "recreate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Recreate meeting
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Session guide</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Run and close the mentorship session from one place.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Join the call, keep the learner conversation active, and close the session with a short summary once the call is done.
            </p>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Provider</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{providerLabel(context.call_provider)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Mode</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{context.mode === "video" ? "Video mentorship" : "Audio mentorship"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Request</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">Mentorship Request #{context.request_id}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refreshSessionContext()}
                disabled={actionBusy !== null}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {actionBusy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh access
              </button>
              <button
                type="button"
                onClick={() => router.push(exitHref)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <MessageSquareText className="h-4 w-4" />
                Back to workflow
              </button>
            </div>
          </section>

          {isHost ? (
            <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Mentor actions</p>
              <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Complete the call cleanly.</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Add a short summary, then close the session so the workflow moves into the completed state for both sides.
              </p>
              <textarea
                value={sessionSummary}
                onChange={(event) => setSessionSummary(event.target.value)}
                className="mt-5 min-h-[150px] w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white"
                placeholder="Key takeaways, next steps, essay themes covered, or a short mentorship summary."
              />
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void completeSession()}
                  disabled={actionBusy !== null}
                  className="inline-flex items-center gap-2 rounded-full bg-[#091a4a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#10286c] disabled:opacity-60"
                >
                  {actionBusy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Complete session
                </button>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
