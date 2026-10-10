import { useEffect, useRef, useState } from "react";
import type { Task } from "../shared/types";
import "./companion.css";

const cues: Record<string, string> = {
  idle: "An idea? Let's give it a little spark.",
  running: "On it! Follow my progress below.",
  queued: "Your task is in the queue.",
  waiting_approval: "A quick review from you, then we're off!",
  waiting_input: "I need one detail to keep going.",
  completed: "Your results are ready to explore!",
  failed: "I hit a snag. Let's look at the details.",
  paused: "Taking a breather. Ready when you are.",
  cancelled: "Stopped. What's next?",
};

export function Companion({ task, voice, activity }: { task?: Task; voice: boolean; activity?: string }) {
  const state = task?.status || "idle";
  const [collapsed, setCollapsed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const previous = useRef(`${task?.id}:${state}`);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  function speak(text: string) {
    if (!canSpeak) return;
    // Only local installed voices: no email/task text or external TTS service.
    const local = window.speechSynthesis.getVoices().filter(v => v.localService);
    const selected = local.find(v => v.lang.startsWith("en")) || local[0];
    if (!selected) { setVoiceError("No local voice is available on this device."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selected;
    utterance.rate = 1.05;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => { setSpeaking(false); setVoiceError("Voice playback is unavailable."); };
    setVoiceError("");
    window.speechSynthesis.speak(utterance);
  }
  useEffect(() => {
    const next = `${task?.id}:${state}`;
    if (previous.current !== next && voice && voiceReady &&
      ["completed", "failed", "waiting_approval", "waiting_input"].includes(state)) speak(cues[state]);
    previous.current = next;
  }, [task?.id, state, voice, voiceReady]);
  useEffect(() => {
    if (!voice) { window.speechSynthesis?.cancel(); setSpeaking(false); setVoiceReady(false); }
    return () => window.speechSynthesis?.cancel();
  }, [voice]);
  return <section className={`companion ${collapsed ? "compact" : ""} state-${state} ${speaking ? "speaking" : ""}`} aria-label="Shadow companion">
    <header><span><i /> SHADOW <small>your little spark</small></span><button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand companion" : "Collapse companion"}>{collapsed ? "+" : "−"}</button></header>
    {!collapsed && <>
      <div className="companion-stage">
        <span className="companion-star star-one">✧</span><span className="companion-star star-two">✦</span>
        <svg viewBox="0 0 300 290" role="img" aria-label="Shadow, an original anime companion with violet hair and a teal outfit">
          <ellipse cx="150" cy="274" rx="78" ry="9" fill="#514175" opacity=".22" />
          <g className="character-body">
            <path d="M89 143Q58 235 83 259L115 233 191 254Q230 220 213 127Z" fill="#302946" />
            <path d="M120 213Q88 218 77 271H224Q211 222 180 213Z" fill="#79d9ce" stroke="#332b4f" strokeWidth="4" />
            <path d="M115 220L150 252 187 220 178 273H121Z" fill="#39314f" />
            <path d="M134 204V223L150 236 168 221V203" fill="#ffcfbd" stroke="#433151" strokeWidth="3" />
            <path d="M100 236L89 267M200 236L211 267" stroke="#408c95" strokeWidth="3" />
            <path d="M147 245L137 258 149 269 162 257Z" fill="#c8acff" />
            <g className="character-head">
              <path d="M75 137Q57 42 146 31 240 31 229 145L204 204H90Z" fill="#49365f" stroke="#332b4f" strokeWidth="4" />
              <ellipse cx="88" cy="161" rx="13" ry="18" fill="#ffd9c7" /><ellipse cx="213" cy="161" rx="13" ry="18" fill="#ffd9c7" />
              <path d="M88 111Q150 72 212 112L208 167Q202 216 151 224 99 215 91 170Z" fill="#ffe3d4" stroke="#433151" strokeWidth="3" />
              <path d="M78 136Q82 59 154 50 221 56 220 141L187 113 179 85 161 135 145 100 119 137 111 106 92 147Z" fill="#645083" stroke="#332b4f" strokeWidth="3" />
              <path d="M95 83Q114 57 146 61M185 67L204 95" stroke="#b198d9" strokeWidth="7" strokeLinecap="round" opacity=".6" />
              <path d="M103 148Q118 140 132 148M170 148Q184 139 197 147" stroke="#544064" strokeWidth="3" fill="none" strokeLinecap="round" />
              <g className="character-eyes">
                <ellipse cx="119" cy="166" rx="14" ry="20" fill="white" /><ellipse cx="182" cy="166" rx="14" ry="20" fill="white" />
                <ellipse cx="121" cy="168" rx="10" ry="17" fill="#8969ca" /><ellipse cx="180" cy="168" rx="10" ry="17" fill="#8969ca" />
                <ellipse cx="121" cy="171" rx="5" ry="10" fill="#332b4f" /><ellipse cx="180" cy="171" rx="5" ry="10" fill="#332b4f" />
                <circle cx="117" cy="159" r="5" fill="white" /><circle cx="176" cy="159" r="5" fill="white" />
                <path d="M102 155Q117 144 133 154M168 154Q184 144 199 155" stroke="#332b4f" strokeWidth="4" fill="none" />
              </g>
              <ellipse cx="106" cy="190" rx="13" ry="5" fill="#ef9eb1" opacity=".6" /><ellipse cx="195" cy="190" rx="13" ry="5" fill="#ef9eb1" opacity=".6" />
              <path className="character-mouth" d="M141 199Q150 208 160 199" stroke="#95556f" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M202 97L207 108 219 111 208 117 204 129 198 116 186 111 198 107Z" fill="#9be8dc" stroke="#3c4967" strokeWidth="2" />
              <path className="character-tuft" d="M147 33Q130 6 158 17L164 36" fill="#645083" stroke="#332b4f" strokeWidth="3" />
            </g>
          </g>
          <g className="shadow-spark"><path d="M244 166Q266 151 278 172L272 189 280 202 262 196Q240 196 239 181Z" fill="#b69aea" /><circle cx="251" cy="178" r="2.5" fill="#312842" /><circle cx="266" cy="178" r="2.5" fill="#312842" /></g>
        </svg>
      </div>
      <div className="companion-caption"><strong>{cues[state]}</strong><p>{state === "running" ? activity || "Planning the next step." : "Ideas, drafts, and a little momentum."}</p></div>
      {voice && <button className="companion-voice" disabled={!canSpeak} onClick={() => { setVoiceReady(true); speak("Hi! I'm Shadow. Let's make something happen."); }}>{voiceReady ? "Hear greeting" : "Enable voice on this device"}</button>}
      {voiceError && <small role="status">{voiceError}</small>}
    </>}
  </section>;
}
