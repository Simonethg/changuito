'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Lang } from './lang.ts';

export type DictationError = 'unsupported' | 'denied' | 'missed' | 'failed';

/**
 * The speech engine, as little of it as this hook touches.
 *
 * Typed by hand because the DOM lib this project compiles against does not
 * ship `SpeechRecognition`, and a `lib` bump would be a bigger change than
 * the three fields we read.
 */
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }>;
}

interface SpeechEngine {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechResultEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function engine(): SpeechEngine | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechEngine;
    webkitSpeechRecognition?: new () => SpeechEngine;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/**
 * One utterance into the composer.
 *
 * `onText(text, false)` is the live transcript. `onText(text, true)` means
 * they finished talking and the words are a search. Stopping from the send
 * button aborts without that second call, so a typed message is not sent twice.
 */
export function useDictation(lang: Lang, onText: (text: string, done: boolean) => void) {
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const rec = useRef<SpeechEngine | null>(null);
  const skipSubmit = useRef(false);
  /** Bumps when a click is cancelled, so a permission prompt that resolves late does not start. */
  const generation = useRef(0);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);

  const stop = useCallback(() => {
    skipSubmit.current = true;
    generation.current += 1;
    rec.current?.abort();
    rec.current = null;
    setListening(false);
  }, []);

  const toggle = useCallback((prefix: string) => {
    if (rec.current) {
      rec.current.stop();
      return;
    }
    const next = engine();
    if (!next) {
      setError('unsupported');
      return;
    }
    setError(null);
    skipSubmit.current = false;
    // Speech recognition on a computer does not raise the permission sheet by
    // itself. Asking for the microphone here, still inside the click, is what
    // makes Chrome and Safari show it. The tracks are dropped immediately:
    // dictation uses the speech engine, not this stream.
    const mine = ++generation.current;
    const ask = navigator.mediaDevices?.getUserMedia?.({ audio: true });
    void (async () => {
      if (ask) {
        try {
          const stream = await ask;
          for (const track of stream.getTracks()) track.stop();
        } catch (err) {
          const name = err instanceof DOMException ? err.name : '';
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
            setError('denied');
            return;
          }
        }
      }
      if (generation.current !== mine) return;
    const base = prefix.trim();
    let latest = base;
    let heard = false;
    next.lang = lang === 'en' ? 'en-US' : 'es-AR';
    next.continuous = false;
    next.interimResults = true;
    next.onresult = (ev) => {
      let spoken = '';
      for (let i = 0; i < ev.results.length; i++) {
        spoken += ev.results[i]?.[0]?.transcript ?? '';
      }
      spoken = spoken.trim();
      if (!spoken) return;
      heard = true;
      latest = [base, spoken].filter(Boolean).join(' ');
      onTextRef.current(latest, false);
    };
    next.onerror = (ev) => {
      if (ev.error === 'aborted') return;
      if (ev.error === 'no-speech') {
        setError('missed');
        return;
      }
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setError('denied');
        return;
      }
      setError('failed');
    };
    next.onend = () => {
      rec.current = null;
      setListening(false);
      if (skipSubmit.current) {
        skipSubmit.current = false;
        return;
      }
      if (heard && latest.trim()) onTextRef.current(latest.trim(), true);
    };
      rec.current = next;
      try {
        next.start();
        setListening(true);
      } catch {
        rec.current = null;
        setError('failed');
      }
    })();
  }, [lang]);

  useEffect(() => () => rec.current?.abort(), []);

  return { listening, error, toggle, stop, clearError: () => setError(null) };
}
