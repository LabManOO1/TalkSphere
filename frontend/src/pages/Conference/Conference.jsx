import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import apiClient from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import styles from "./Conference.module.scss";


const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

const WS_URL = API_URL.replace(/^http/, "ws");

const RTC_CONFIGURATION = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
      ],
    },
  ],
};


function getInitial(username) {
  const normalizedUsername = username?.trim();

  return normalizedUsername
    ? normalizedUsername[0].toUpperCase()
    : "?";
}


function VideoIcon({ disabled = false }) {
  return disabled ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3 21 21" />
      <path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10" />
      <path d="M14 6h2a2 2 0 0 1 2 2v2l3-2v8l-3-2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="15" height="12" rx="2" />
      <path d="m18 10 3-2v8l-3-2" />
    </svg>
  );
}


function MicrophoneIcon({ disabled = false }) {
  return disabled ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3 21 21" />
      <path d="M9 9v3a3 3 0 0 0 4.5 2.6" />
      <path d="M15 9V5a3 3 0 0 0-5.7-1.3" />
      <path d="M5 10v2a7 7 0 0 0 11.7 5.2" />
      <path d="M19 10v2a7 7 0 0 1-.4 2.3" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  );
}


function ScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="m9 10 3-3 3 3" />
      <path d="M12 7v7" />
    </svg>
  );
}


function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
    </svg>
  );
}


function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11 11 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1 11 11 0 0 0 .6 3.6 1 1 0 0 1-.2 1Z" />
    </svg>
  );
}


function ParticipantTile({
  participant,
  compact = false,
}) {
  const setVideoElement = useCallback(
    (videoElement) => {
      if (
        videoElement &&
        participant.stream &&
        videoElement.srcObject !== participant.stream
      ) {
        videoElement.srcObject = participant.stream;
      }
    },
    [participant.stream],
  );

  const className = [
    styles.participantTile,
    compact ? styles.compactTile : "",
    participant.isSharing ? styles.screenTile : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className}>
      {participant.hasVideo && participant.stream ? (
        <video
          ref={setVideoElement}
          autoPlay
          playsInline
          muted={participant.isLocal}
          className={styles.participantVideo}
        />
      ) : (
        <div className={styles.avatar}>
          {getInitial(participant.username)}
        </div>
      )}

      <div className={styles.participantFooter}>
        <span className={styles.participantName}>
          {participant.username}
          {participant.isLocal ? " (Вы)" : ""}
        </span>

        {participant.isMuted && (
          <span
            className={styles.mutedBadge}
            title="Микрофон выключен"
          >
            <MicrophoneIcon disabled />
          </span>
        )}
      </div>
    </article>
  );
}


function Conference() {
  const { inviteCode } = useParams();
  const navigate = useNavigate();

  const {
    user,
    loading: authLoading,
    isAuthenticated,
  } = useAuth();

  const [room, setRoom] = useState(null);
  const [roomParticipants, setRoomParticipants] =
    useState([]);

  const [cameraStream, setCameraStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [remoteMedia, setRemoteMedia] = useState({});

  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] =
    useState(true);

  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const websocketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());

  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const mountedRef = useRef(true);


  const sendSignal = useCallback((payload) => {
    const websocket = websocketRef.current;

    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify(payload));
    }
  }, []);


  const getCurrentVideoTrack = useCallback(() => {
    const screenTrack =
      screenStreamRef.current?.getVideoTracks()[0];

    if (screenTrack) {
      return screenTrack;
    }

    return (
      cameraStreamRef.current?.getVideoTracks()[0] ||
      null
    );
  }, []);


  const getVideoSender = useCallback((peerConnection) => {
    const directSender = peerConnection
      .getSenders()
      .find((sender) => sender.track?.kind === "video");

    if (directSender) {
      return directSender;
    }

    return peerConnection
      .getTransceivers()
      .find(
        (transceiver) =>
          transceiver.receiver?.track?.kind === "video",
      )?.sender;
  }, []);


  const flushPendingCandidates = useCallback(
    async (remoteUserId, peerConnection) => {
      const pendingCandidates =
        pendingCandidatesRef.current.get(remoteUserId) ||
        [];

      if (!peerConnection.remoteDescription) {
        return;
      }

      for (const candidate of pendingCandidates) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (candidateError) {
          console.error(
            "Не удалось добавить ICE-кандидат:",
            candidateError,
          );
        }
      }

      pendingCandidatesRef.current.delete(remoteUserId);
    },
    [],
  );


  const createPeerConnection = useCallback(
    (remoteUserId) => {
      const normalizedUserId = String(remoteUserId);

      const existingConnection =
        peerConnectionsRef.current.get(normalizedUserId);

      if (existingConnection) {
        return existingConnection;
      }

      const peerConnection = new RTCPeerConnection(
        RTC_CONFIGURATION,
      );

      const currentCameraStream =
        cameraStreamRef.current;

      const audioTrack =
        currentCameraStream?.getAudioTracks()[0] || null;

      const videoTrack = getCurrentVideoTrack();

      if (audioTrack) {
        peerConnection.addTrack(
          audioTrack,
          currentCameraStream,
        );
      } else {
        peerConnection.addTransceiver("audio", {
          direction: "sendrecv",
        });
      }

      if (videoTrack) {
        const sourceStream =
          screenStreamRef.current ||
          currentCameraStream ||
          new MediaStream([videoTrack]);

        peerConnection.addTrack(videoTrack, sourceStream);
      } else {
        peerConnection.addTransceiver("video", {
          direction: "sendrecv",
        });
      }

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        sendSignal({
          type: "ice-candidate",
          target_user_id: normalizedUserId,
          candidate: event.candidate,
        });
      };

      peerConnection.ontrack = (event) => {
        const incomingStream =
          event.streams?.[0] ||
          new MediaStream([event.track]);

        setRemoteStreams((currentStreams) => ({
          ...currentStreams,
          [normalizedUserId]: incomingStream,
        }));
      };

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;

        if (state === "failed" || state === "closed") {
          peerConnection.close();
          peerConnectionsRef.current.delete(
            normalizedUserId,
          );

          setRemoteStreams((currentStreams) => {
            const nextStreams = { ...currentStreams };
            delete nextStreams[normalizedUserId];
            return nextStreams;
          });
        }
      };

      peerConnectionsRef.current.set(
        normalizedUserId,
        peerConnection,
      );

      return peerConnection;
    },
    [getCurrentVideoTrack, sendSignal],
  );


  const createOfferFor = useCallback(
    async (remoteUserId) => {
      const normalizedUserId = String(remoteUserId);

      if (
        !normalizedUserId ||
        normalizedUserId === String(user?.id)
      ) {
        return;
      }

      const peerConnection =
        createPeerConnection(normalizedUserId);

      try {
        const offer =
          await peerConnection.createOffer();

        await peerConnection.setLocalDescription(offer);

        sendSignal({
          type: "offer",
          target_user_id: normalizedUserId,
          sdp: peerConnection.localDescription,
        });
      } catch (offerError) {
        console.error(
          "Не удалось создать WebRTC offer:",
          offerError,
        );
      }
    },
    [
      createPeerConnection,
      sendSignal,
      user?.id,
    ],
  );


  const closeRemoteParticipant = useCallback(
    (remoteUserId) => {
      const normalizedUserId = String(remoteUserId);

      const peerConnection =
        peerConnectionsRef.current.get(normalizedUserId);

      if (peerConnection) {
        peerConnection.close();
        peerConnectionsRef.current.delete(
          normalizedUserId,
        );
      }

      pendingCandidatesRef.current.delete(
        normalizedUserId,
      );

      setRemoteStreams((currentStreams) => {
        const nextStreams = { ...currentStreams };
        delete nextStreams[normalizedUserId];
        return nextStreams;
      });

      setRemoteMedia((currentMedia) => {
        const nextMedia = { ...currentMedia };
        delete nextMedia[normalizedUserId];
        return nextMedia;
      });
    },
    [],
  );


  const loadRoom = useCallback(async () => {
    try {
      const response = await apiClient.get(
        `/rooms/${inviteCode}`,
      );

      const roomData = response.data;

      if (roomData.status === "ended") {
        setError("Эта конференция уже завершена");
        return false;
      }

      if (mountedRef.current) {
        setRoom(roomData);
        setRoomParticipants(
          roomData.participants || [],
        );
      }

      return true;
    } catch (requestError) {
      if (mountedRef.current) {
        setError(
          requestError.response?.data?.detail ||
            "Не удалось загрузить конференцию",
        );
      }

      return false;
    }
  }, [inviteCode]);


  const updateMediaStatus = useCallback(
    async (statusUpdate) => {
      setRoomParticipants((currentParticipants) =>
        currentParticipants.map((participant) =>
          String(participant.user_id) ===
          String(user?.id)
            ? {
                ...participant,
                ...statusUpdate,
              }
            : participant,
        ),
      );

      sendSignal({
        type: "media-state",
        ...statusUpdate,
      });

      try {
        await apiClient.patch(
          `/rooms/${inviteCode}/participants/status`,
          statusUpdate,
        );
      } catch (statusError) {
        console.error(
          "Не удалось обновить статус участника:",
          statusError,
        );
      }
    },
    [inviteCode, sendSignal, user?.id],
  );


  const handleSignalMessage = useCallback(
    async (message) => {
      const {
        type,
        from_user_id: fromUserId,
        from_username: fromUsername,
      } = message;

      if (type === "room_state") {
        const existingParticipants =
          message.participants || [];

        setRoomParticipants((currentParticipants) => {
          const participantsMap = new Map(
            currentParticipants.map((participant) => [
              String(participant.user_id),
              participant,
            ]),
          );

          for (const participant of existingParticipants) {
            const participantId = String(
              participant.user_id,
            );

            if (!participantsMap.has(participantId)) {
              participantsMap.set(participantId, {
                ...participant,
                is_muted: false,
                is_video_off: true,
                is_screen_sharing: false,
              });
            }
          }

          return Array.from(participantsMap.values());
        });

        for (const participant of existingParticipants) {
          await createOfferFor(participant.user_id);
        }

        return;
      }

      if (type === "participant_joined") {
        const participantId = String(
          message.user_id,
        );

        setRoomParticipants((currentParticipants) => {
          const exists = currentParticipants.some(
            (participant) =>
              String(participant.user_id) ===
              participantId,
          );

          if (exists) {
            return currentParticipants;
          }

          return [
            ...currentParticipants,
            {
              user_id: participantId,
              username:
                message.username || "Участник",
              is_muted: false,
              is_video_off: true,
              is_screen_sharing: false,
            },
          ];
        });

        return;
      }

      if (type === "participant_left") {
        const participantId = String(
          message.user_id,
        );

        closeRemoteParticipant(participantId);

        setRoomParticipants((currentParticipants) =>
          currentParticipants.filter(
            (participant) =>
              String(participant.user_id) !==
              participantId,
          ),
        );

        return;
      }

      if (!fromUserId) {
        return;
      }

      const normalizedRemoteId = String(fromUserId);

      setRoomParticipants((currentParticipants) => {
        const exists = currentParticipants.some(
          (participant) =>
            String(participant.user_id) ===
            normalizedRemoteId,
        );

        if (exists) {
          return currentParticipants;
        }

        return [
          ...currentParticipants,
          {
            user_id: normalizedRemoteId,
            username: fromUsername || "Участник",
            is_muted: false,
            is_video_off: true,
            is_screen_sharing: false,
          },
        ];
      });

      if (type === "offer") {
        const peerConnection =
          createPeerConnection(normalizedRemoteId);

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(message.sdp),
        );

        await flushPendingCandidates(
          normalizedRemoteId,
          peerConnection,
        );

        const answer =
          await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(answer);

        sendSignal({
          type: "answer",
          target_user_id: normalizedRemoteId,
          sdp: peerConnection.localDescription,
        });

        return;
      }

      if (type === "answer") {
        const peerConnection =
          peerConnectionsRef.current.get(
            normalizedRemoteId,
          );

        if (!peerConnection) {
          return;
        }

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(message.sdp),
        );

        await flushPendingCandidates(
          normalizedRemoteId,
          peerConnection,
        );

        return;
      }

      if (type === "ice-candidate") {
        const peerConnection =
          createPeerConnection(normalizedRemoteId);

        const candidate = new RTCIceCandidate(
          message.candidate,
        );

        if (peerConnection.remoteDescription) {
          try {
            await peerConnection.addIceCandidate(
              candidate,
            );
          } catch (candidateError) {
            console.error(
              "Не удалось добавить ICE-кандидат:",
              candidateError,
            );
          }
        } else {
          const currentCandidates =
            pendingCandidatesRef.current.get(
              normalizedRemoteId,
            ) || [];

          pendingCandidatesRef.current.set(
            normalizedRemoteId,
            [...currentCandidates, candidate],
          );
        }

        return;
      }

      if (
        type === "media-state" ||
        type === "status_update"
      ) {
        const mediaUpdate = {
          is_muted: Boolean(message.is_muted),
          is_video_off: Boolean(
            message.is_video_off,
          ),
          is_screen_sharing: Boolean(
            message.is_screen_sharing,
          ),
        };

        setRemoteMedia((currentMedia) => ({
          ...currentMedia,
          [normalizedRemoteId]: {
            ...currentMedia[normalizedRemoteId],
            ...mediaUpdate,
          },
        }));

        setRoomParticipants((currentParticipants) =>
          currentParticipants.map((participant) =>
            String(participant.user_id) ===
            normalizedRemoteId
              ? {
                  ...participant,
                  ...mediaUpdate,
                }
              : participant,
          ),
        );
      }
    },
    [
      closeRemoteParticipant,
      createOfferFor,
      createPeerConnection,
      flushPendingCandidates,
      sendSignal,
    ],
  );


  useEffect(() => {
    mountedRef.current = true;

    const previousBodyOverflow =
      document.body.style.overflow;

    const previousHtmlOverflow =
      document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow =
      "hidden";

    return () => {
      mountedRef.current = false;

      document.body.style.overflow =
        previousBodyOverflow;

      document.documentElement.style.overflow =
        previousHtmlOverflow;
    };
  }, []);


  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!isAuthenticated) {
      localStorage.setItem(
        "return_after_login",
        `/conference/${inviteCode}`,
      );

      navigate("/login", { replace: true });
      return;
    }

    let cancelled = false;

    const initializeConference = async () => {
      setIsConnecting(true);
      setError("");

      const roomAvailable = await loadRoom();

      if (!roomAvailable || cancelled) {
        setIsConnecting(false);
        return;
      }

      try {
        const mediaStream =
          await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

        if (cancelled) {
          mediaStream
            .getTracks()
            .forEach((track) => track.stop());

          return;
        }

        cameraStreamRef.current = mediaStream;
        setCameraStream(mediaStream);
        setCameraEnabled(true);
        setMicrophoneEnabled(true);
      } catch (mediaError) {
        console.warn(
          "Камера или микрофон недоступны:",
          mediaError,
        );

        cameraStreamRef.current =
          new MediaStream();

        setCameraStream(
          cameraStreamRef.current,
        );

        setCameraEnabled(false);
        setMicrophoneEnabled(false);
      }

      const token = localStorage.getItem("token");

      const websocket = new WebSocket(
        `${WS_URL}/ws/signal/${encodeURIComponent(
          inviteCode,
        )}?token=${encodeURIComponent(token)}`,
      );

      websocketRef.current = websocket;

      websocket.onopen = () => {
        if (!cancelled) {
          setIsConnecting(false);

          sendSignal({
            type: "media-state",
            is_muted: !microphoneEnabled,
            is_video_off: !cameraEnabled,
            is_screen_sharing: false,
          });
        }
      };

      websocket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await handleSignalMessage(message);
        } catch (messageError) {
          console.error(
            "Ошибка обработки WebSocket-сообщения:",
            messageError,
          );
        }
      };

      websocket.onerror = () => {
        if (!cancelled) {
          setError(
            "Не удалось подключиться к конференции",
          );
          setIsConnecting(false);
        }
      };

      websocket.onclose = (event) => {
        if (
          !cancelled &&
          event.code !== 1000 &&
          event.code !== 4001
        ) {
          setError(
            event.reason ||
              "Соединение с конференцией закрыто",
          );
        }
      };
    };

    initializeConference();

    return () => {
      cancelled = true;

      websocketRef.current?.close(1000);
      websocketRef.current = null;

      for (const peerConnection of
        peerConnectionsRef.current.values()) {
        peerConnection.close();
      }

      peerConnectionsRef.current.clear();
      pendingCandidatesRef.current.clear();

      cameraStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      screenStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());
    };
  }, [
    authLoading,
    cameraEnabled,
    handleSignalMessage,
    inviteCode,
    isAuthenticated,
    loadRoom,
    microphoneEnabled,
    navigate,
    sendSignal,
  ]);


  useEffect(() => {
    if (!isAuthenticated || error) {
      return undefined;
    }

    const intervalId = window.setInterval(
      loadRoom,
      1500,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [error, isAuthenticated, loadRoom]);


  const replaceVideoTrackForAll = useCallback(
    async (videoTrack) => {
      for (const [
        remoteUserId,
        peerConnection,
      ] of peerConnectionsRef.current.entries()) {
        const videoSender =
          getVideoSender(peerConnection);

        if (videoSender) {
          await videoSender.replaceTrack(videoTrack);
        } else if (videoTrack) {
          peerConnection.addTrack(
            videoTrack,
            screenStreamRef.current ||
              cameraStreamRef.current ||
              new MediaStream([videoTrack]),
          );

          await createOfferFor(remoteUserId);
        }
      }
    },
    [
      createOfferFor,
      getVideoSender,
    ],
  );


  const toggleMicrophone = async () => {
    let audioTrack =
      cameraStreamRef.current?.getAudioTracks()[0];

    if (!audioTrack && !microphoneEnabled) {
      try {
        const audioStream =
          await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });

        audioTrack = audioStream.getAudioTracks()[0];

        const currentTracks =
          cameraStreamRef.current?.getTracks() || [];

        const updatedStream = new MediaStream([
          ...currentTracks,
          audioTrack,
        ]);

        cameraStreamRef.current = updatedStream;
        setCameraStream(updatedStream);

        for (const peerConnection of
          peerConnectionsRef.current.values()) {
          const audioSender = peerConnection
            .getSenders()
            .find(
              (sender) =>
                sender.track?.kind === "audio",
            );

          if (audioSender) {
            await audioSender.replaceTrack(audioTrack);
          }
        }
      } catch {
        setError(
          "Не удалось получить доступ к микрофону",
        );
        return;
      }
    }

    if (!audioTrack) {
      return;
    }

    const nextEnabled = !microphoneEnabled;
    audioTrack.enabled = nextEnabled;

    setMicrophoneEnabled(nextEnabled);

    await updateMediaStatus({
      is_muted: !nextEnabled,
    });
  };


  const toggleCamera = async () => {
    let videoTrack =
      cameraStreamRef.current?.getVideoTracks()[0];

    if (!videoTrack && !cameraEnabled) {
      try {
        const videoStream =
          await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });

        videoTrack = videoStream.getVideoTracks()[0];

        const currentTracks =
          cameraStreamRef.current?.getTracks() || [];

        const updatedStream = new MediaStream([
          ...currentTracks,
          videoTrack,
        ]);

        cameraStreamRef.current = updatedStream;
        setCameraStream(updatedStream);

        if (!screenStreamRef.current) {
          await replaceVideoTrackForAll(videoTrack);
        }
      } catch {
        setError(
          "Не удалось получить доступ к камере",
        );
        return;
      }
    }

    if (!videoTrack) {
      return;
    }

    const nextEnabled = !cameraEnabled;
    videoTrack.enabled = nextEnabled;

    setCameraEnabled(nextEnabled);

    if (!screenStreamRef.current) {
      await replaceVideoTrackForAll(
        nextEnabled ? videoTrack : null,
      );
    }

    await updateMediaStatus({
      is_video_off: !nextEnabled,
    });
  };


  const stopScreenSharing = useCallback(async () => {
    const currentScreenStream =
      screenStreamRef.current;

    if (!currentScreenStream) {
      return;
    }

    currentScreenStream
      .getTracks()
      .forEach((track) => {
        track.onended = null;
        track.stop();
      });

    screenStreamRef.current = null;
    setScreenStream(null);

    const cameraTrack =
      cameraStreamRef.current?.getVideoTracks()[0];

    const replacementTrack =
      cameraEnabled && cameraTrack
        ? cameraTrack
        : null;

    await replaceVideoTrackForAll(replacementTrack);

    await updateMediaStatus({
      is_screen_sharing: false,
      is_video_off: !cameraEnabled,
    });
  }, [
    cameraEnabled,
    replaceVideoTrackForAll,
    updateMediaStatus,
  ]);


  const toggleScreenSharing = async () => {
    if (screenStreamRef.current) {
      await stopScreenSharing();
      return;
    }

    try {
      const displayStream =
        await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });

      const screenTrack =
        displayStream.getVideoTracks()[0];

      screenStreamRef.current = displayStream;
      setScreenStream(displayStream);

      screenTrack.onended = () => {
        stopScreenSharing();
      };

      await replaceVideoTrackForAll(screenTrack);

      await updateMediaStatus({
        is_screen_sharing: true,
      });
    } catch (screenError) {
      if (screenError.name !== "NotAllowedError") {
        setError(
          "Не удалось запустить демонстрацию экрана",
        );
      }
    }
  };


  const copyInviteLink = async () => {
    const inviteLink = `${window.location.origin}/conference/${inviteCode}`;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      setError("Не удалось скопировать ссылку");
    }
  };


  const leaveConference = async () => {
    try {
      await apiClient.post(
        `/rooms/${inviteCode}/leave`,
      );
    } catch {
      // WebSocket всё равно будет закрыт,
      // а бэкенд удалит участника.
    }

    websocketRef.current?.close(1000);

    cameraStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    screenStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    navigate("/meetings", { replace: true });
  };


  const conferenceParticipants = useMemo(() => {
    const participantsMap = new Map();

    for (const participant of roomParticipants) {
      const participantId = String(
        participant.user_id,
      );

      const isLocal =
        participantId === String(user?.id);

      const mediaState = isLocal
        ? {}
        : remoteMedia[participantId] || {};

      const participantStream = isLocal
        ? screenStream || cameraStream
        : remoteStreams[participantId] || null;

      const isSharing = isLocal
        ? Boolean(screenStream)
        : Boolean(
            mediaState.is_screen_sharing ??
              participant.is_screen_sharing,
          );

      const videoTracks =
        participantStream?.getVideoTracks() || [];

      const hasLiveVideoTrack = videoTracks.some(
        (track) =>
          track.readyState === "live" &&
          track.enabled,
      );

      const isVideoOff = isLocal
        ? !cameraEnabled
        : Boolean(
            mediaState.is_video_off ??
              participant.is_video_off,
          );

      participantsMap.set(participantId, {
        ...participant,
        id: participantId,
        isLocal,
        stream: participantStream,
        isSharing,
        hasVideo:
          isSharing ||
          (!isVideoOff && hasLiveVideoTrack),
        isMuted: isLocal
          ? !microphoneEnabled
          : Boolean(
              mediaState.is_muted ??
                participant.is_muted,
            ),
      });
    }

    if (
      user?.id &&
      !participantsMap.has(String(user.id))
    ) {
      const localStream =
        screenStream || cameraStream;

      const localVideoTrack =
        localStream?.getVideoTracks()[0];

      participantsMap.set(String(user.id), {
        id: String(user.id),
        user_id: String(user.id),
        username: user.username || "Вы",
        isLocal: true,
        stream: localStream,
        isSharing: Boolean(screenStream),
        hasVideo: Boolean(
          screenStream ||
            (cameraEnabled &&
              localVideoTrack?.enabled),
        ),
        isMuted: !microphoneEnabled,
      });
    }

    for (const [
      participantId,
      participantStream,
    ] of Object.entries(remoteStreams)) {
      if (participantsMap.has(participantId)) {
        continue;
      }

      const mediaState =
        remoteMedia[participantId] || {};

      const hasLiveVideoTrack =
        participantStream
          ?.getVideoTracks()
          .some(
            (track) =>
              track.readyState === "live" &&
              track.enabled,
          );

      participantsMap.set(participantId, {
        id: participantId,
        user_id: participantId,
        username: "Участник",
        isLocal: false,
        stream: participantStream,
        isSharing: Boolean(
          mediaState.is_screen_sharing,
        ),
        hasVideo:
          Boolean(mediaState.is_screen_sharing) ||
          (!mediaState.is_video_off &&
            hasLiveVideoTrack),
        isMuted: Boolean(mediaState.is_muted),
      });
    }

    return Array.from(participantsMap.values());
  }, [
    cameraEnabled,
    cameraStream,
    microphoneEnabled,
    remoteMedia,
    remoteStreams,
    roomParticipants,
    screenStream,
    user,
  ]);


  const sharingParticipants = useMemo(
    () =>
      conferenceParticipants.filter(
        (participant) => participant.isSharing,
      ),
    [conferenceParticipants],
  );

  const cameraParticipants = useMemo(
    () =>
      conferenceParticipants.filter(
        (participant) =>
          !participant.isSharing &&
          participant.hasVideo,
      ),
    [conferenceParticipants],
  );

  const mainParticipants =
    sharingParticipants.length > 0
      ? sharingParticipants
      : cameraParticipants;

  const sidebarParticipants =
    sharingParticipants.length > 0
      ? conferenceParticipants.filter(
          (participant) =>
            !participant.isSharing,
        )
      : conferenceParticipants.filter(
          (participant) =>
            !participant.hasVideo,
        );


  if (isConnecting || authLoading) {
    return (
      <main className={styles.statePage}>
        <div className={styles.loader} />
        <p>Подключаемся к конференции…</p>
      </main>
    );
  }


  if (error) {
    return (
      <main className={styles.statePage}>
        <h1>Не удалось открыть конференцию</h1>
        <p>{error}</p>

        <button
          type="button"
          onClick={() => navigate("/meetings")}
        >
          Вернуться к встречам
        </button>
      </main>
    );
  }


  const mainGridClass = [
    styles.mainGrid,
    mainParticipants.length === 1
      ? styles.oneTile
      : "",
    mainParticipants.length === 2
      ? styles.twoTiles
      : "",
    mainParticipants.length > 2
      ? styles.manyTiles
      : "",
  ]
    .filter(Boolean)
    .join(" ");


  return (
    <main className={styles.conferencePage}>
      <header className={styles.conferenceHeader}>
        <button
          type="button"
          className={styles.brand}
          onClick={() => navigate("/")}
        >
          TalkSphere
        </button>

        <div className={styles.roomInformation}>
          <strong>
            {room?.title || "Конференция"}
          </strong>

          <span>Код: {inviteCode}</span>
        </div>
      </header>

      <section
        className={`${styles.conferenceWorkspace} ${
          sidebarParticipants.length === 0
            ? styles.withoutSidebar
            : ""
        }`}
      >
        <div className={styles.mainStage}>
          {mainParticipants.length > 0 ? (
            <div className={mainGridClass}>
              {mainParticipants.map(
                (participant) => (
                  <ParticipantTile
                    key={participant.id}
                    participant={participant}
                  />
                ),
              )}
            </div>
          ) : (
            <div className={styles.emptyStage}>
              <span>Камеры участников выключены</span>
            </div>
          )}
        </div>

        {sidebarParticipants.length > 0 && (
          <aside className={styles.sidebar}>
            {sidebarParticipants.map(
              (participant) => (
                <ParticipantTile
                  key={participant.id}
                  participant={participant}
                  compact
                />
              ),
            )}
          </aside>
        )}
      </section>

      <footer className={styles.controls}>
        <button
          type="button"
          className={`${styles.controlButton} ${
            !microphoneEnabled
              ? styles.disabledControl
              : ""
          }`}
          onClick={toggleMicrophone}
          title={
            microphoneEnabled
              ? "Выключить микрофон"
              : "Включить микрофон"
          }
        >
          <MicrophoneIcon
            disabled={!microphoneEnabled}
          />
        </button>

        <button
          type="button"
          className={`${styles.controlButton} ${
            !cameraEnabled
              ? styles.disabledControl
              : ""
          }`}
          onClick={toggleCamera}
          title={
            cameraEnabled
              ? "Выключить камеру"
              : "Включить камеру"
          }
        >
          <VideoIcon disabled={!cameraEnabled} />
        </button>

        <button
          type="button"
          className={`${styles.controlButton} ${
            screenStream ? styles.activeControl : ""
          }`}
          onClick={toggleScreenSharing}
          title="Демонстрация экрана"
        >
          <ScreenIcon />
        </button>

        <button
          type="button"
          className={styles.controlButton}
          onClick={copyInviteLink}
          title="Скопировать ссылку"
        >
          <LinkIcon />
        </button>

        <button
          type="button"
          className={styles.leaveButton}
          onClick={leaveConference}
          title="Выйти"
        >
          <PhoneIcon />
        </button>

        {copied && (
          <span className={styles.copyMessage}>
            Ссылка скопирована
          </span>
        )}
      </footer>
    </main>
  );
}


export default Conference;