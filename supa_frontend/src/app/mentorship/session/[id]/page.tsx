"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { premiumApi } from "@/lib/premiumApi";
import { toast } from "sonner";
import { Loader2, Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff } from "lucide-react";

export default function MentorshipSessionRoom() {
    const params = useParams();
    const router = useRouter();
    const sessionId = typeof params.id === "string" ? parseInt(params.id, 10) : 0;

    const [loading, setLoading] = useState(true);
    const [context, setContext] = useState<any>(null);
    const [zoomClient, setZoomClient] = useState<any>(null);

    const [inSession, setInSession] = useState(false);
    const [audioMuted, setAudioMuted] = useState(true);
    const [videoOn, setVideoOn] = useState(false);
    const [screenSharing, setScreenSharing] = useState(false);

    const videoContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!sessionId) return;

        const init = async () => {
            try {
                const res = await premiumApi.post(`/mentorship/sessions/${sessionId}/call-context`, {});
                const data = res.data;
                setContext(data);

                if (data.call_provider === "zoom_video_sdk") {
                    // Dynamically import Zoom SDK to avoid SSR issues
                    // @ts-ignore
                    const ZoomVideo = (await import("@zoom/videosdk")).default;
                    const client = ZoomVideo.createClient();
                    client.init("en-US", "Global", { patchJsMedia: true, enforceMultipleVideos: true });
                    setZoomClient(client);
                } else if (data.join_url) {
                    // If it's a regular zoom meeting or custom link
                    window.location.href = data.join_url;
                }
            } catch (e: any) {
                toast.error("Failed to load session context", { description: e.message });
            } finally {
                setLoading(false);
            }
        };
        init();

        return () => {
            if (zoomClient && inSession) {
                zoomClient.leave();
            }
        };
    }, [sessionId]);

    const joinSession = async () => {
        if (!zoomClient || !context) return;
        try {
            setLoading(true);
            await zoomClient.join(context.sdk_session_name, context.sdk_signature, context.sdk_user_name, context.sdk_key);
            setInSession(true);

            const media = zoomClient.getMediaStream();
            if (videoContainerRef.current) {
                await media.startVideo();
                await media.renderVideo(videoContainerRef.current, zoomClient.getCurrentUserInfo().userId, 640, 360, 0, 0, 1);
                setVideoOn(true);
            }
            await media.startAudio();
            await media.muteAudio();
        } catch (e: any) {
            toast.error("Failed to join call", { description: e.message });
        } finally {
            setLoading(false);
        }
    };

    const leaveSession = async () => {
        if (zoomClient) {
            await zoomClient.leave();
        }
        setInSession(false);
        router.push("/mentorship/manage");
    };

    const toggleAudio = async () => {
        if (!zoomClient) return;
        const media = zoomClient.getMediaStream();
        if (audioMuted) {
            await media.unmuteAudio();
            setAudioMuted(false);
        } else {
            await media.muteAudio();
            setAudioMuted(true);
        }
    };

    const toggleVideo = async () => {
        if (!zoomClient) return;
        const media = zoomClient.getMediaStream();
        if (videoOn) {
            await media.stopVideo();
            setVideoOn(false);
        } else {
            await media.startVideo();
            if (videoContainerRef.current) {
                await media.renderVideo(videoContainerRef.current, zoomClient.getCurrentUserInfo().userId, 640, 360, 0, 0, 1);
            }
            setVideoOn(true);
        }
    };

    const toggleScreenShare = async () => {
        if (!zoomClient) return;
        const media = zoomClient.getMediaStream();
        if (screenSharing) {
            await media.stopShareScreen();
            setScreenSharing(false);
        } else {
            if (videoContainerRef.current) {
                await media.startShareScreen(videoContainerRef.current);
                setScreenSharing(true);
            }
        }
    };

    if (loading && !inSession) {
        return (
            <div className="flex h-[calc(100vh-80px)] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
        );
    }

    if (context && context.call_provider !== "zoom_video_sdk") {
        return (
            <div className="flex h-[calc(100vh-80px)] flex-col items-center justify-center p-6 text-center">
                <h2 className="text-xl font-semibold text-slate-800">External Call Provider</h2>
                <p className="mt-2 text-slate-600">This session uses an external platform.</p>
                {context.join_url ? (
                    <a href={context.join_url} target="_blank" rel="noreferrer" className="mt-6 rounded bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-700">
                        Open Call Link
                    </a>
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-80px)] flex-col bg-slate-900 text-white">
            {/* Top Bar */}
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
                <div>
                    <h1 className="text-lg font-semibold">{context?.sdk_session_name || `Mentorship Session ${sessionId}`}</h1>
                    <p className="text-xs text-slate-400">{context?.sdk_role_type === 1 ? "Host" : "Participant"}</p>
                </div>
                {!inSession && (
                    <button onClick={joinSession} className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-700">
                        Join Call
                    </button>
                )}
            </div>

            {/* Main Call Area */}
            <div className="flex-1 overflow-hidden relative p-4">
                {!inSession ? (
                    <div className="flex h-full items-center justify-center">
                        <p className="text-slate-400 text-sm">Click Join Call when you are ready.</p>
                    </div>
                ) : (
                    <div className="h-full w-full rounded-xl bg-black overflow-hidden relative shadow-inner">
                        <div ref={videoContainerRef} className="h-full w-full object-cover">
                            {/* Video elements will be rendered here by Zoom SDK */}
                        </div>

                        {!videoOn && (
                            <div className="absolute inset-0 flex items-center justify-center flex-col gap-3">
                                <div className="h-20 w-20 rounded-full bg-slate-800 flex items-center justify-center">
                                    <span className="text-2xl font-bold bg-gradient-to-br from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                                        {context?.sdk_user_name?.substring(0, 2).toUpperCase()}
                                    </span>
                                </div>
                                <p className="text-slate-400 text-sm">Camera is off</p>
                            </div>
                        )}

                        {audioMuted && (
                            <div className="absolute bottom-4 left-4 rounded-full bg-rose-500/80 p-2 backdrop-blur-sm">
                                <MicOff className="h-4 w-4 text-white" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Controls Bar */}
            {inSession && (
                <div className="flex items-center justify-center gap-4 border-t border-slate-800 p-4">
                    <button
                        onClick={toggleAudio}
                        className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${audioMuted ? "bg-rose-500 hover:bg-rose-600" : "bg-slate-700 hover:bg-slate-600"
                            }`}
                    >
                        {audioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </button>

                    <button
                        onClick={toggleVideo}
                        className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${!videoOn ? "bg-rose-500 hover:bg-rose-600" : "bg-slate-700 hover:bg-slate-600"
                            }`}
                    >
                        {!videoOn ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                    </button>

                    <button
                        onClick={toggleScreenShare}
                        className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${screenSharing ? "bg-emerald-500 hover:bg-emerald-600" : "bg-slate-700 hover:bg-slate-600"
                            }`}
                    >
                        <MonitorUp className="h-5 w-5" />
                    </button>

                    <button
                        onClick={leaveSession}
                        className="flex h-12 px-6 items-center justify-center rounded-full bg-rose-600 font-semibold transition-colors hover:bg-rose-700 text-sm gap-2 ml-4"
                    >
                        <PhoneOff className="h-4 w-4" />
                        Leave
                    </button>
                </div>
            )}
        </div>
    );
}
