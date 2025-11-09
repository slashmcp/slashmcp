import { useCallback, useRef, useState } from "react";
import { synthesizeSpeech } from "@/lib/voice";

type VoicePlaybackOptions = {
  voice?: string;
  languageCode?: string;
  speakingRate?: number;
  pitch?: number;
};

export function useVoicePlayback(defaultEnabled = false) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    audioRef.current = null;
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string, options: VoicePlaybackOptions = {}) => {
      if (!enabled) return;
      if (!text.trim()) return;

      stop();
      setIsSpeaking(true);

      try {
        const { audioContent } = await synthesizeSpeech(text, options);
        if (!audioContent) {
          throw new Error("No audio content returned from synthesis.");
        }

        const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        audioRef.current = audio;

        await audio.play();
        audio.onended = () => {
          setIsSpeaking(false);
          audioRef.current = null;
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          audioRef.current = null;
        };
      } catch (error) {
        setIsSpeaking(false);
        audioRef.current = null;
        throw error;
      }
    },
    [enabled, stop],
  );

  const toggle = useCallback(() => {
    setEnabled(prev => {
      if (prev) {
        stop();
      }
      return !prev;
    });
  }, [stop]);

  return {
    enabled,
    toggle,
    speak,
    stop,
    isSpeaking,
    setEnabled,
  };
}

