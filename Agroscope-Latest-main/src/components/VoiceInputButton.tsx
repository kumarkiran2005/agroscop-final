import { useEffect, useRef } from "react";
import { Mic, Loader2, AlertCircle } from "lucide-react";
import {
  useSpeechRecognition,
} from "@/hooks/useSpeechRecognition";
import type { Language } from "@/lib/languages";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Errors that mean "stop trying" — restarting on these would loop forever. */
const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "not-supported"]);
/** Restart budget: more than this inside the window means something is wrong. */
const MAX_RESTARTS_PER_WINDOW = 15;
const RESTART_WINDOW_MS = 60_000;

export interface VoiceInputButtonProps {
  selectedLanguage: Language;
  onTranscript: (text: string, isFinal: boolean) => void;
  onSend: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  disabled?: boolean;
  className?: string;
  /**
   * Hands-free mode. The browser recognizer is single-utterance and also dies on
   * a silent pause ("no-speech"), so keeping it alive means restarting it
   * ourselves on a keep-alive tick. Used while Autopilot is ON so it genuinely
   * listens in the background — including with the chat panel closed.
   */
  continuous?: boolean;
  /** Bump to force a restart (e.g. the "resume" button on the background pill). */
  startSignal?: number;
  /** Reports real mic state upward so the UI never claims to listen when it isn't. */
  onStatusChange?: (state: { listening: boolean; error: string | null }) => void;
}

export default function VoiceInputButton({
  selectedLanguage,
  onTranscript,
  onSend,
  onListeningChange,
  disabled,
  className,
  continuous = false,
  startSignal = 0,
  onStatusChange,
}: VoiceInputButtonProps) {
  // Refs so the keep-alive tick and recognizer callbacks always read current
  // values without tearing down and rebuilding the recognizer between utterances.
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  const manualStopRef = useRef(false);
  const fatalRef = useRef<string | null>(null);
  const restartsRef = useRef({ count: 0, windowStart: 0 });
  const startRef = useRef<() => void>(() => {});
  const statusRef = useRef<string>("idle");

  const onResult = (transcript: string, isFinal: boolean) => {
    onTranscript(transcript, isFinal);
    if (isFinal && transcript.trim()) {
      setTimeout(() => onSend(transcript.trim()), 800);
    }
  };

  const handleError = (error: string) => {
    // "no-speech" / "aborted" / "network" are transient — the keep-alive tick
    // restarts. Permission failures are terminal; retrying would spin forever.
    if (FATAL_ERRORS.has(error)) {
      fatalRef.current =
        error === "not-allowed" || error === "service-not-allowed"
          ? "Microphone blocked. Allow mic access for localhost, then tap to retry."
          : "Voice input needs Chrome or Edge.";
    }
  };

  const { isSupported, status, errorMessage, start, stop, clearError } =
    useSpeechRecognition({
      langCode: selectedLanguage.code,
      onResult,
      onError: handleError,
    });
  startRef.current = start;
  statusRef.current = status;

  const isListening = status === "listening";
  const isProcessing = status === "processing";
  const isError = status === "error";

  /* Report true state upward (never a hardcoded "Listening"). */
  useEffect(() => {
    onListeningChange?.(isListening);
    onStatusChange?.({ listening: isListening, error: fatalRef.current ?? errorMessage });
  }, [isListening, errorMessage, onListeningChange, onStatusChange]);

  /* Entering hands-free mode clears prior stop/fatal state and starts fresh. */
  useEffect(() => {
    if (continuous) {
      manualStopRef.current = false;
      fatalRef.current = null;
      restartsRef.current = { count: 0, windowStart: Date.now() };
    } else {
      stop();
    }
  }, [continuous, stop]);

  /* Explicit resume request from outside (background pill). */
  useEffect(() => {
    if (startSignal <= 0) return;
    manualStopRef.current = false;
    fatalRef.current = null;
    restartsRef.current = { count: 0, windowStart: Date.now() };
    startRef.current();
  }, [startSignal]);

  /* Keep-alive: the only thing that makes background listening real. */
  useEffect(() => {
    if (!continuous || !isSupported || disabled) return;
    const id = window.setInterval(() => {
      if (!continuousRef.current || manualStopRef.current || fatalRef.current) return;
      if (statusRef.current === "listening") return;

      const now = Date.now();
      const w = restartsRef.current;
      if (now - w.windowStart > RESTART_WINDOW_MS) {
        w.windowStart = now;
        w.count = 0;
      }
      if (w.count >= MAX_RESTARTS_PER_WINDOW) {
        fatalRef.current = "Voice keeps stopping — tap the mic to retry.";
        return;
      }
      w.count += 1;
      startRef.current();
    }, 900);
    return () => window.clearInterval(id);
  }, [continuous, isSupported, disabled]);

  // Clear transient errors so the keep-alive can restart (skip fatal ones).
  useEffect(() => {
    if (status !== "error" || fatalRef.current) return;
    const t = setTimeout(clearError, continuous ? 400 : 2000);
    return () => clearTimeout(t);
  }, [status, clearError, continuous]);

  const handleClick = () => {
    if (isListening) {
      manualStopRef.current = true; // explicit stop beats hands-free resume
      stop();
      return;
    }
    if (!isSupported || disabled) return;
    manualStopRef.current = false;
    fatalRef.current = null;
    restartsRef.current = { count: 0, windowStart: Date.now() };
    start();
  };

  const tooltip = !isSupported
    ? "Voice input requires Chrome or Edge. You can type your message."
    : fatalRef.current
      ? fatalRef.current
      : isError && errorMessage
        ? errorMessage
        : isListening
          ? continuous
            ? "Listening hands-free — speak a command"
            : "Listening... speak now"
          : `Click to speak in ${selectedLanguage.name}`;

  const button = (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || !isSupported}
      aria-label={tooltip}
      className={className}
      style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isError
          ? "rgba(245, 158, 11, 0.2)"
          : isListening
            ? "transparent"
            : "var(--field)",
        border: `1px solid ${isListening ? "rgba(255, 68, 68, 0.6)" : "rgba(0, 255, 127, 0.3)"}`,
        color: isError ? "var(--harvest, #f5a623)" : isListening ? "#ff4444" : "var(--crop-green)",
        boxShadow: isListening ? "0 0 0 0 rgba(255, 68, 68, 0.4)" : undefined,
        animation: isListening ? "voice-pulse 1s ease-in-out infinite" : undefined,
      }}
    >
      {isError && <AlertCircle className="h-5 w-5" />}
      {isProcessing && <Loader2 className="h-5 w-5 animate-spin" />}
      {!isError && !isProcessing && <Mic className="h-5 w-5" />}
    </button>
  );

  return (
    <>
      <style>{`
        @keyframes voice-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); }
          50% { box-shadow: 0 0 0 12px rgba(255, 68, 68, 0); }
        }
      `}</style>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
