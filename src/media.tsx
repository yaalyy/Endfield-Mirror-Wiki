import { useEffect, useRef, useState } from "react";
import type { Audio } from "../shared/types.ts";
import { sourceHome } from "../shared/paths.ts";
import { asset } from "./data.ts";
export function Picture({
  url,
  description = "",
  className = "",
  width,
  source = sourceHome,
}: {
  url: string;
  description?: string;
  className?: string;
  width?: number;
  source?: string;
}) {
  const [failed, setFailed] = useState(false),
    [version, setVersion] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  if (!url) return null;
  if (failed)
    return (
      <span className="media-error" role="status">
        图片加载失败{" "}
        <button
          onClick={() => {
            setFailed(false);
            setVersion((x) => x + 1);
          }}
        >
          重试
        </button>{" "}
        <a href={source} target="_blank" rel="noreferrer">
          打开原站
        </a>
      </span>
    );
  return (
    <>
      <button
        className={`image-button ${className}`}
        aria-label={`放大图片：${description || "查看原图"}`}
        style={width ? { maxWidth: width } : undefined}
        onClick={() => dialog.current?.showModal()}
      >
        <img
          key={version}
          src={asset(url)}
          alt={description}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </button>
      <dialog
        ref={dialog}
        className="lightbox"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <button
          className="close"
          onClick={() => dialog.current?.close()}
          autoFocus
          aria-label="关闭图片"
        >
          关闭 ×
        </button>
        <LightboxImage dialog={dialog} url={url} description={description} />
      </dialog>
    </>
  );
}
function LightboxImage({
  dialog,
  url,
  description,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  url: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const update = () => setOpen(el.open);
    el.addEventListener("toggle", update);
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ["open"] });
    return () => {
      el.removeEventListener("toggle", update);
      observer.disconnect();
    };
  }, [dialog]);
  return open ? (
    <img src={asset(url)} alt={description} referrerPolicy="no-referrer" />
  ) : null;
}
let playing: HTMLAudioElement | undefined;
export function stopAudio() {
  playing?.pause();
  playing = undefined;
}
export function AudioPlayer({
  audio,
  source,
}: {
  audio: Audio;
  source: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<"idle" | "playing" | "error" | "loading">(
    "idle",
  );
  useEffect(() => {
    const element = ref.current;
    return () => {
      element?.pause();
      if (playing === element) playing = undefined;
    };
  }, []);
  const play = async () => {
    const el = ref.current!;
    if (state === "playing") {
      el.pause();
      return;
    }
    if (playing && playing !== el) playing.pause();
    playing = el;
    setState("loading");
    el.src = audio.resourceUrl;
    try {
      await el.play();
      setState("playing");
    } catch {
      setState("error");
    }
  };
  return (
    <div className="audio-row">
      <button
        onClick={play}
        aria-label={`${state === "playing" ? "暂停" : "播放"} ${audio.title}`}
        disabled={state === "loading"}
      >
        {state === "playing" ? "Ⅱ" : state === "loading" ? "…" : "▶"}
      </button>
      <div>
        <strong>{audio.title}</strong>
        <p>{audio.profile}</p>
        {state === "error" && (
          <span className="media-error" role="status">
            语音加载失败 <button onClick={play}>重试</button>{" "}
            <a href={source} target="_blank" rel="noreferrer">
              打开原站
            </a>
          </span>
        )}
      </div>
      <audio
        ref={ref}
        preload="none"
        onPause={() => setState((s) => (s === "error" ? s : "idle"))}
        onEnded={() => setState("idle")}
        onError={() => setState("error")}
      />
    </div>
  );
}
