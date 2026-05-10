import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

/**
 * Phase 1 voice input — Web Speech API wrapper.
 *
 * Browser support: Chrome / Edge (full), Safari 14.1+ (partial),
 * Firefox (behind dom.webspeech.recognition.enable flag — treated
 * as unsupported here so production users get the disabled state
 * instead of a misleading button that does nothing).
 *
 * The Web Speech API requires a user gesture (button click) to start
 * AND a secure context (HTTPS / localhost). Both are satisfied here:
 * the button is the gesture, and Career-Buddy is deployed over HTTPS.
 *
 * Voice is NEVER the only input — every surface that mounts this
 * component also keeps its plain text input so the experience
 * degrades cleanly when the API is missing or permission is denied.
 */

type SpeechResult = { transcript: string; confidence: number };
type SpeechAlternative = SpeechResult & { 0: SpeechResult };
type SpeechResultList = {
  length: number;
  item(i: number): SpeechAlternative;
  [i: number]: SpeechAlternative;
};
type SpeechRecognitionEvent = {
  results: SpeechResultList;
  resultIndex: number;
};
type SpeechRecognitionErrorEvent = { error: string; message?: string };
type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognition;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Props = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  lang?: string;
  size?: "sm" | "md";
  label?: string;
  className?: string;
};

export function VoiceMic({
  onTranscript,
  disabled = false,
  lang = "en-US",
  size = "md",
  label,
  className = "",
}: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = lang;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const transcript = last?.[0]?.transcript?.trim();
      if (transcript) onTranscript(transcript);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") {
        setError("Didn't catch that — try again.");
      } else if (e.error === "not-allowed") {
        setError("Microphone permission denied. Check browser settings.");
      } else if (e.error === "audio-capture") {
        setError("No microphone detected.");
      } else {
        setError("Voice input failed. Use the text field instead.");
      }
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onstart = () => {
      setListening(true);
      setError(null);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setError("Could not start voice input.");
      setListening(false);
    }
  }

  function stop() {
    recRef.current?.stop();
  }

  const dimensions = size === "sm" ? "w-9 h-9" : "w-11 h-11";
  const iconSize = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  if (supported === null) {
    return (
      <button
        type="button"
        disabled
        aria-label="Loading voice input"
        className={`${dimensions} inline-flex items-center justify-center rounded-full border border-cinema-mint bg-white opacity-50 ${className}`}
      >
        <Mic className={iconSize} />
      </button>
    );
  }

  if (!supported || disabled) {
    return (
      <button
        type="button"
        disabled
        aria-label={
          !supported
            ? "Voice input not supported in this browser"
            : "Voice input disabled"
        }
        title={
          !supported
            ? "Voice input needs Chrome, Edge, or Safari 14.1+. Type instead."
            : "Voice input disabled"
        }
        className={`${dimensions} inline-flex items-center justify-center rounded-full border border-cinema-mint bg-white text-cinema-ink-mute opacity-60 cursor-not-allowed ${className}`}
      >
        <MicOff className={iconSize} />
      </button>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-label={listening ? "Stop voice input" : label ?? "Start voice input"}
        aria-pressed={listening}
        className={`${dimensions} inline-flex items-center justify-center rounded-full border transition-colors ${
          listening
            ? "border-cinema-moss bg-cinema-moss text-cinema-cream voice-mic-pulse"
            : "border-cinema-mint bg-white text-cinema-ink hover:bg-cinema-mint/40"
        }`}
      >
        {listening ? <MicOff className={iconSize} /> : <Mic className={iconSize} />}
      </button>
      {error && (
        <span role="alert" className="text-cinema-caption text-cinema-ink-mute">
          {error}
        </span>
      )}
    </div>
  );
}
