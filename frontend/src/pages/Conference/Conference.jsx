import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import apiClient from "../../api/client";
import styles from "./Conference.module.scss";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL =
  import.meta.env.VITE_WS_URL || API_URL.replace(/^http/i, "ws").replace(/\/$/, "");

const getErrorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (!error.response) return "Не удалось подключиться к серверу";
  return fallback;
};

const decodeTokenPayload = (token) => {
  try {
    const rawPayload = token.split(".")[1];
    const normalized = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
};

const createClientId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

function MicIcon({ off = false }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="11" y="4" width="10" height="16" rx="5" />
      <path d="M7 15a9 9 0 0 0 18 0M16 24v5M11 29h10" />
      {off && <path className={styles.slash} d="M4 4l24 24" />}
    </svg>
  );
}

function CameraIcon({ off = false }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="8" width="18" height="16" rx="4" />
      <path d="m22 13 6-4v14l-6-4" />
      {off && <path className={styles.slash} d="M4 4l24 24" />}
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="5" width="26" height="18" rx="3" />
      <path d="M11 28h10M16 23v5M11 14l5-5 5 5M16 9v10" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="10" y="10" width="17" height="17" rx="3" />
      <path d="M22 10V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h3" />
    </svg>
  );
}

function HangupIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 21c3-3 6.7-4.5 11-4.5S24 18 27 21" />
      <path d="M5 21v5M27 21v5" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="11" cy="11" r="5" />
      <circle cx="22" cy="11" r="5" />
      <path d="M2 28c.4-8 3.5-12 9-12 4 0 6.7 2.1 8 6" />
      <path d="M13 28c.4-8 3.5-12 9-12s8.6 4 9 12H13Z" />
    </svg>
  );
}

function VideoTile({
  stream,
  name,
  muted = false,
  videoOff = false,
  isLocal = false,
  mirror = false,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const initials = (name || "Участник")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <article className={styles.videoTile}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`${videoOff ? styles.videoHidden : ""} ${
          mirror ? styles.mirroredVideo : ""
        }`}
      />

      {(!stream || videoOff) && (
        <div className={styles.avatar} aria-hidden="true">
          {initials || "У"}
        </div>
      )}

      <div className={styles.tileFooter}>
        <span>{isLocal ? `${name || "Вы"} (вы)` : name || "Участник"}</span>
        {videoOff && <CameraIcon off />}
      </div>
    </article>
  );
}

function Conference() {
  const { inviteCode: rawInviteCode } = useParams();
  const inviteCode = useMemo(
    () => decodeURIComponent(rawInviteCode || "").trim().toUpperCase(),
    [rawInviteCode],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const token = localStorage.getItem("token");
  const tokenPayload = decodeTokenPayload(token || "");
  const currentUserId = user?.id || tokenPayload?.sub || null;
  const currentUsername = user?.username || "Участник";

  const [room, setRoom] = useState(location.state?.room || null);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");
  const [connectionState, setConnectionState] = useState("connecting");
  const [localPreview, setLocalPreview] = useState(null);
  const [remoteParticipants, setRemoteParticipants] = useState([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);

  const clientIdRef = useRef(createClientId());
  const wsRef = useRef(null);
  const localStreamRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const queuedCandidatesRef = useRef(new Map());
  const isLeavingRef = useRef(false);
  const micEnabledRef = useRef(true);
  const cameraEnabledRef = useRef(true);
  const isSharingRef = useRef(false);

  const updateRemoteParticipant = useCallback((peerId, patch) => {
    setRemoteParticipants((current) => {
      const existing = current.find((participant) => participant.peerId === peerId);

      if (existing) {
        return current.map((participant) =>
          participant.peerId === peerId ? { ...participant, ...patch } : participant,
        );
      }

      return [
        ...current,
        {
          peerId,
          username: "Участник",
          stream: null,
          isMuted: false,
          isVideoOff: false,
          ...patch,
        },
      ];
    });
  }, []);

  const removePeer = useCallback((peerId) => {
    const connection = peerConnectionsRef.current.get(peerId);
    if (connection) connection.close();

    peerConnectionsRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
    queuedCandidatesRef.current.delete(peerId);
    setRemoteParticipants((current) =>
      current.filter((participant) => participant.peerId !== peerId),
    );
  }, []);

  const sendSignal = useCallback((message) => {
    const socket = wsRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;

    socket.send(
      JSON.stringify({
        ...message,
        from: clientIdRef.current,
        userId: currentUserId,
        username: currentUsername,
      }),
    );
  }, [currentUserId, currentUsername]);

  const flushQueuedCandidates = useCallback(async (peerId, connection) => {
    const queued = queuedCandidatesRef.current.get(peerId) || [];

    for (const candidate of queued) {
      try {
        await connection.addIceCandidate(candidate);
      } catch (candidateError) {
        console.error("Не удалось добавить ICE-кандидат", candidateError);
      }
    }

    queuedCandidatesRef.current.delete(peerId);
  }, []);

  const createPeerConnection = useCallback(
    (peerId, username) => {
      const existing = peerConnectionsRef.current.get(peerId);
      if (existing) {
        if (username) updateRemoteParticipant(peerId, { username });
        return existing;
      }

      const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnectionsRef.current.set(peerId, connection);
      updateRemoteParticipant(peerId, { username: username || "Участник" });

      localStreamRef.current?.getTracks().forEach((track) => {
        connection.addTrack(track, localStreamRef.current);
      });

      connection.onicecandidate = (event) => {
        if (!event.candidate) return;
        sendSignal({ type: "ice-candidate", target: peerId, candidate: event.candidate });
      };

      connection.ontrack = (event) => {
        let remoteStream = event.streams?.[0];

        if (!remoteStream) {
          remoteStream = remoteStreamsRef.current.get(peerId) || new MediaStream();
          remoteStream.addTrack(event.track);
        }

        remoteStreamsRef.current.set(peerId, remoteStream);
        updateRemoteParticipant(peerId, { stream: remoteStream });
      };

      connection.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(connection.connectionState)) {
          removePeer(peerId);
        }
      };

      return connection;
    },
    [removePeer, sendSignal, updateRemoteParticipant],
  );

  const createOffer = useCallback(
    async (peerId, username) => {
      try {
        const connection = createPeerConnection(peerId, username);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        sendSignal({
          type: "offer",
          target: peerId,
          sdp: connection.localDescription,
        });
      } catch (offerError) {
        console.error("Не удалось создать WebRTC offer", offerError);
      }
    },
    [createPeerConnection, sendSignal],
  );

  const broadcastMediaStatus = useCallback(
    (next = {}) => {
      sendSignal({
        type: "media-status",
        isMuted: next.isMuted ?? !micEnabledRef.current,
        isVideoOff: next.isVideoOff ?? !cameraEnabledRef.current,
        isScreenSharing: next.isScreenSharing ?? isSharingRef.current,
      });
    },
    [sendSignal],
  );

  const updateStatusOnServer = useCallback(
    async (statusPatch) => {
      try {
        await apiClient.patch(
          `/rooms/${encodeURIComponent(inviteCode)}/participants/status`,
          statusPatch,
        );
      } catch {
        // Статус интерфейса уже изменён локально; запрос повторится при следующем действии.
      }
    },
    [inviteCode],
  );

  const handleSignalMessage = useCallback(
    async (event) => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!message?.type || message.from === clientIdRef.current) return;
      if (message.target && message.target !== clientIdRef.current) return;

      const peerId = message.from;

      try {
        if (message.type === "join") {
          await createOffer(peerId, message.username);
          broadcastMediaStatus();
          return;
        }

        if (message.type === "offer") {
          const connection = createPeerConnection(peerId, message.username);
          await connection.setRemoteDescription(message.sdp);
          await flushQueuedCandidates(peerId, connection);

          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          sendSignal({
            type: "answer",
            target: peerId,
            sdp: connection.localDescription,
          });
          broadcastMediaStatus();
          return;
        }

        if (message.type === "answer") {
          const connection = peerConnectionsRef.current.get(peerId);
          if (!connection) return;

          await connection.setRemoteDescription(message.sdp);
          await flushQueuedCandidates(peerId, connection);
          return;
        }

        if (message.type === "ice-candidate") {
          const connection =
            peerConnectionsRef.current.get(peerId) ||
            createPeerConnection(peerId, message.username);

          if (connection.remoteDescription) {
            await connection.addIceCandidate(message.candidate);
          } else {
            const queued = queuedCandidatesRef.current.get(peerId) || [];
            queued.push(message.candidate);
            queuedCandidatesRef.current.set(peerId, queued);
          }
          return;
        }

        if (message.type === "media-status") {
          updateRemoteParticipant(peerId, {
            username: message.username || "Участник",
            isMuted: Boolean(message.isMuted),
            isVideoOff: Boolean(message.isVideoOff),
            isScreenSharing: Boolean(message.isScreenSharing),
          });
          return;
        }

        if (message.type === "leave") removePeer(peerId);
      } catch (signalError) {
        console.error("Ошибка обработки сигнального сообщения", signalError);
      }
    },
    [
      broadcastMediaStatus,
      createOffer,
      createPeerConnection,
      flushQueuedCandidates,
      removePeer,
      sendSignal,
      updateRemoteParticipant,
    ],
  );

  const stopMedia = useCallback(() => {
    screenTrackRef.current?.stop();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenTrackRef.current = null;
    cameraTrackRef.current = null;
    localStreamRef.current = null;
  }, []);

  const closeConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((connection) => connection.close());
    peerConnectionsRef.current.clear();
    remoteStreamsRef.current.clear();
    queuedCandidatesRef.current.clear();
  }, []);

  useEffect(() => {
    if (authLoading) return undefined;

    if (!isAuthenticated || !token) {
      const path = `/conference/${encodeURIComponent(inviteCode)}`;
      sessionStorage.setItem("redirect_after_login", path);
      navigate("/login", { replace: true, state: { from: path } });
      return undefined;
    }

    let cancelled = false;
    let participantPoll;

    const initialize = async () => {
      try {
        const roomResponse = await apiClient.get(
          `/rooms/${encodeURIComponent(inviteCode)}`,
        );

        if (cancelled) return;
        setRoom(roomResponse.data);

        let mediaStream;

        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
        } catch (mediaError) {
          console.warn("Камера или микрофон недоступны", mediaError);
          mediaStream = new MediaStream();
          micEnabledRef.current = false;
          cameraEnabledRef.current = false;
          setMicEnabled(false);
          setCameraEnabled(false);
        }

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = mediaStream;
        cameraTrackRef.current = mediaStream.getVideoTracks()[0] || null;
        setLocalPreview(mediaStream);

        const socket = new WebSocket(
          `${WS_URL}/ws/signal/${encodeURIComponent(inviteCode)}?token=${encodeURIComponent(token)}`,
        );
        wsRef.current = socket;

        socket.onopen = () => {
          if (cancelled) return;
          setConnectionState("connected");
          sendSignal({ type: "join" });
          broadcastMediaStatus({
            isMuted: mediaStream.getAudioTracks().every((track) => !track.enabled),
            isVideoOff: mediaStream.getVideoTracks().every((track) => !track.enabled),
            isScreenSharing: isSharingRef.current,
          });
        };

        socket.onmessage = handleSignalMessage;

        socket.onerror = () => {
          if (!cancelled) {
            setConnectionState("error");
            setError("Не удалось подключиться к серверу конференции");
          }
        };

        socket.onclose = () => {
          if (!cancelled && !isLeavingRef.current) {
            setConnectionState("error");
            setError("Соединение с конференцией прерванo");
          }
        };

        participantPoll = window.setInterval(async () => {
          try {
            const response = await apiClient.get(
              `/rooms/${encodeURIComponent(inviteCode)}`,
            );
            if (!cancelled) setRoom(response.data);
          } catch {
            // Временная ошибка обновления списка не прерывает звонок.
          }
        }, 4000);
      } catch (requestError) {
        if (!cancelled) {
          setError(getErrorMessage(requestError, "Конференция не найдена"));
          setConnectionState("error");
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    };

    initialize();

    return () => {
      cancelled = true;
      if (participantPoll) window.clearInterval(participantPoll);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "leave",
            from: clientIdRef.current,
            userId: currentUserId,
            username: currentUsername,
          }),
        );
      }

      wsRef.current?.close();
      wsRef.current = null;
      closeConnections();
      stopMedia();
    };
  }, [
    authLoading,
    broadcastMediaStatus,
    closeConnections,
    currentUserId,
    currentUsername,
    handleSignalMessage,
    inviteCode,
    isAuthenticated,
    navigate,
    sendSignal,
    stopMedia,
    token,
  ]);

  const toggleMicrophone = async () => {
    const nextEnabled = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });

    micEnabledRef.current = nextEnabled;
    setMicEnabled(nextEnabled);
    broadcastMediaStatus({ isMuted: !nextEnabled });
    await updateStatusOnServer({ is_muted: !nextEnabled });
  };

  const toggleCamera = async () => {
    if (isSharing) return;

    const nextEnabled = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });

    cameraEnabledRef.current = nextEnabled;
    setCameraEnabled(nextEnabled);
    broadcastMediaStatus({ isVideoOff: !nextEnabled });
    await updateStatusOnServer({ is_video_off: !nextEnabled });
  };

  const stopScreenShare = useCallback(async () => {
    const screenTrack = screenTrackRef.current;
    if (!screenTrack) return;

    screenTrack.onended = null;
    screenTrack.stop();
    screenTrackRef.current = null;

    const cameraTrack = cameraTrackRef.current;

    for (const connection of peerConnectionsRef.current.values()) {
      const sender = connection
        .getSenders()
        .find((item) => item.track?.kind === "video" || item.track === screenTrack);

      if (sender) await sender.replaceTrack(cameraTrack || null);
    }

    setLocalPreview(localStreamRef.current);
    isSharingRef.current = false;
    setIsSharing(false);
    broadcastMediaStatus({ isScreenSharing: false, isVideoOff: !cameraEnabled });
    await updateStatusOnServer({ is_screen_sharing: false });
  }, [broadcastMediaStatus, cameraEnabled, updateStatusOnServer]);

  const toggleScreenShare = async () => {
    if (isSharing) {
      await stopScreenShare();
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenTrackRef.current = screenTrack;
      screenTrack.onended = () => void stopScreenShare();

      for (const [peerId, connection] of peerConnectionsRef.current.entries()) {
        const videoSender = connection
          .getSenders()
          .find((sender) => sender.track?.kind === "video");

        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        } else {
          connection.addTrack(screenTrack, displayStream);
          await createOffer(peerId);
        }
      }

      const preview = new MediaStream([
        screenTrack,
        ...localStreamRef.current?.getAudioTracks() || [],
      ]);
      setLocalPreview(preview);
      isSharingRef.current = true;
      setIsSharing(true);
      broadcastMediaStatus({ isScreenSharing: true, isVideoOff: false });
      await updateStatusOnServer({ is_screen_sharing: true });
    } catch (shareError) {
      if (shareError?.name !== "NotAllowedError") {
        setError("Не удалось включить демонстрацию экрана");
      }
    }
  };

  const copyMeetingLink = async () => {
    const link = `${window.location.origin}/conference/${encodeURIComponent(inviteCode)}`;

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Не удалось скопировать ссылку");
    }
  };

  const leaveConference = async () => {
    isLeavingRef.current = true;
    sendSignal({ type: "leave" });

    try {
      await apiClient.post(`/rooms/${encodeURIComponent(inviteCode)}/leave`);
    } catch {
      // Закрытие WebSocket также удаляет участника на текущем бэкенде.
    }

    wsRef.current?.close();
    closeConnections();
    stopMedia();
    navigate("/meetings", { replace: true });
  };

  const displayedParticipants = useMemo(() => {
    const backendParticipants = room?.participants || [];
    const names = new Map();

    backendParticipants.forEach((participant) => {
      names.set(participant.user_id, participant.username);
    });

    remoteParticipants.forEach((participant) => {
      if (participant.username) names.set(participant.peerId, participant.username);
    });

    return [currentUsername, ...Array.from(names.values()).filter((name) => name !== currentUsername)];
  }, [currentUsername, remoteParticipants, room]);

  if (pageLoading || authLoading) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.loader} />
        <p>Подключаемся к конференции…</p>
      </main>
    );
  }

  if (error && !room) {
    return (
      <main className={styles.errorPage}>
        <a href="/" className={styles.brand}>TalkSphere</a>
        <section>
          <h1>Не удалось открыть конференцию</h1>
          <p>{error}</p>
          <button type="button" onClick={() => navigate("/meetings")}>
            Вернуться ко встречам
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <button type="button" className={styles.brand} onClick={() => navigate("/")}>
          TalkSphere
        </button>

        <div className={styles.roomInfo}>
          <strong>{room?.title || "Конференция"}</strong>
          <span>Код: {inviteCode}</span>
        </div>

        <div className={`${styles.connection} ${styles[connectionState]}`}>
          <span />
          {connectionState === "connected" ? "В эфире" : "Подключение"}
        </div>
      </header>

      <main className={styles.conference}>
        {error && <div className={styles.toast}>{error}</div>}
        {copied && <div className={styles.toast}>Ссылка скопирована</div>}

        <section
          className={`${styles.videoGrid} ${
            remoteParticipants.length === 0 ? styles.singleVideo : ""
          }`}
        >
          <VideoTile
            stream={localPreview}
            name={currentUsername}
            muted
            videoOff={!cameraEnabled && !isSharing}
            isLocal
            mirror={!isSharing}
          />

          {remoteParticipants.map((participant) => (
            <VideoTile
              key={participant.peerId}
              stream={participant.stream}
              name={participant.username}
              videoOff={participant.isVideoOff}
            />
          ))}
        </section>

        <aside className={`${styles.participantsPanel} ${participantsOpen ? styles.panelOpen : ""}`}>
          <div className={styles.panelHeader}>
            <h2>Участники ({displayedParticipants.length})</h2>
            <button
              type="button"
              onClick={() => setParticipantsOpen(false)}
              aria-label="Закрыть список участников"
            >
              ×
            </button>
          </div>

          <ul>
            {displayedParticipants.map((name, index) => (
              <li key={`${name}-${index}`}>
                <span>{name.slice(0, 1).toUpperCase()}</span>
                {name}
                {index === 0 && <small>Вы</small>}
              </li>
            ))}
          </ul>
        </aside>
      </main>

      <footer className={styles.controlsBar}>
        <button
          type="button"
          className={!micEnabled ? styles.controlOff : ""}
          onClick={toggleMicrophone}
          aria-label={micEnabled ? "Выключить микрофон" : "Включить микрофон"}
        >
          <MicIcon off={!micEnabled} />
          <span>{micEnabled ? "Микрофон" : "Без звука"}</span>
        </button>

        <button
          type="button"
          className={!cameraEnabled ? styles.controlOff : ""}
          onClick={toggleCamera}
          disabled={isSharing}
          aria-label={cameraEnabled ? "Выключить камеру" : "Включить камеру"}
        >
          <CameraIcon off={!cameraEnabled} />
          <span>{cameraEnabled ? "Камера" : "Без видео"}</span>
        </button>

        <button
          type="button"
          className={isSharing ? styles.controlActive : ""}
          onClick={toggleScreenShare}
          aria-label="Демонстрация экрана"
        >
          <ScreenIcon />
          <span>{isSharing ? "Остановить показ" : "Показать экран"}</span>
        </button>

        <button type="button" onClick={copyMeetingLink} aria-label="Скопировать ссылку">
          <CopyIcon />
          <span>Ссылка</span>
        </button>

        <button
          type="button"
          onClick={() => setParticipantsOpen((value) => !value)}
          aria-label="Участники"
        >
          <PeopleIcon />
          <span>Участники</span>
        </button>

        <button
          type="button"
          className={styles.hangup}
          onClick={leaveConference}
          aria-label="Выйти из конференции"
        >
          <HangupIcon />
          <span>Выйти</span>
        </button>
      </footer>
    </div>
  );
}

export default Conference;
